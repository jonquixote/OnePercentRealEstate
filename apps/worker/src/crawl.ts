// Crawl-job worker. Replaces n8n's 30s polling loop with PG NOTIFY + a
// drain-on-connect catch-up sweep so jobs enqueued while the worker was
// down still get picked up. Pickup latency for live jobs drops from
// ~15s avg to <1s.
//
// Lifecycle
// ---------
// 1. Connect to Postgres (dedicated client for LISTEN — the main pool
//    handles the SELECT/UPDATE work).
// 2. Drain the pending queue (already-enqueued rows from before our
//    subscription started).
// 3. LISTEN crawl_job_enqueued — defined by migration
//    2026_06_03_crawl_jobs_notify.sql.
// 4. On every notification: try to claim ONE row, process it. Honor
//    WORKER_CONCURRENCY as a semaphore.
// 5. On disconnect: reconnect with exponential backoff, then re-drain
//    (notifications during the gap are lost — drain catches them).
// 6. On SIGTERM/SIGINT: stop accepting new notifications, finish
//    in-flight jobs, close pool, exit clean.
//
// Safety nets that still apply
// ----------------------------
// - recycle_stuck_jobs() in 000_base_schema.sql clears jobs stuck in
//   'processing' for >5min.
// - trigger_recycle_crawl_jobs (infrastructure/job_recycle_trigger.sql)
//   re-queues completed jobs when no pending/processing remain (the
//   "continuous cycle" pattern this project uses).

import { Client, Pool, type Notification } from 'pg';
import { loadEnv } from './env.js';
import { getLogger, newTraceId, withTrace, type WorkerLogger } from './logger.js';

const env = loadEnv();
const log = getLogger(env.LOG_LEVEL);

interface CrawlJob {
  readonly id: string; // BIGSERIAL — keep as string to avoid JS bigint friction
  readonly region_type: string;
  readonly region_value: string;
}

// ---------------------------------------------------------------------------
// Pool for short-lived work queries. Single client for LISTEN is separate
// (pg requires that — pooled clients can be returned mid-listen).
// ---------------------------------------------------------------------------

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: Math.max(env.WORKER_CONCURRENCY + 2, 4),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  // pg emits 'error' on the pool when an idle client gets terminated by
  // the DB (restart, network blip). The next .query() call will get a
  // fresh client; we just want to NOT crash the process here.
  log.warn({ err: err.message }, 'pool idle client error');
});

// ---------------------------------------------------------------------------
// Semaphore for WORKER_CONCURRENCY. Tiny FIFO of resolvers.
// ---------------------------------------------------------------------------

class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(max: number) {
    this.available = max;
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    // resolver was called by release(); slot already accounted for there
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      // hand the slot directly to the next waiter
      next();
    } else {
      this.available += 1;
    }
  }
}

const semaphore = new Semaphore(env.WORKER_CONCURRENCY);
let inFlight = 0;
let shuttingDown = false;

// ---------------------------------------------------------------------------
// Claim + process a single job. Returns true if a job was processed,
// false if no claimable row was available (race with another instance).
// ---------------------------------------------------------------------------

async function processJob(jobId: string, parentLog: WorkerLogger): Promise<boolean> {
  const traceId = newTraceId();
  const log = withTrace(parentLog, traceId, { job_id: jobId });

  // Atomic claim: only updates if still pending. If another worker won
  // the race, RETURNING yields zero rows.
  const claim = await pool.query<CrawlJob>(
    `UPDATE crawl_jobs
        SET status = 'processing', started_at = NOW()
      WHERE id = $1 AND status = 'pending'
      RETURNING id::text AS id, region_type, region_value`,
    [jobId],
  );

  if (claim.rowCount === 0) {
    log.debug('job already claimed by another worker');
    return false;
  }

  const job = claim.rows[0];
  const start = Date.now();
  log.info({ region: job.region_value, region_type: job.region_type }, 'claimed crawl job');

  try {
    const saleResult = await scrape(job, 'for_sale', log).catch((err) => {
      log.warn({ err: (err as Error).message }, 'for_sale scrape failed, continuing to for_rent');
      return null;
    });
    const rentResult = await scrape(job, 'for_rent', log).catch((err) => {
      log.warn({ err: (err as Error).message }, 'for_rent scrape failed');
      return null;
    });
    // Third pass: distressed inventory via homeharvest's foreclosure filter. The
    // scraper tags these rows sale_type='foreclosure' (source homeharvest_flag)
    // unless its text classifier finds something more specific.
    const foreclosureResult = await scrape(job, 'for_sale', log, { foreclosure: true }).catch((err) => {
      log.warn({ err: (err as Error).message }, 'foreclosure scrape failed');
      return null;
    });

    if (!saleResult && !rentResult && !foreclosureResult) {
      throw new Error('all scrape passes (for_sale, for_rent, foreclosure) failed');
    }

    const totalCount = (saleResult?.count ?? 0) + (rentResult?.count ?? 0) + (foreclosureResult?.count ?? 0);
    const totalInserted = (saleResult?.inserted ?? 0) + (rentResult?.inserted ?? 0) + (foreclosureResult?.inserted ?? 0);
    const totalSkipped = (saleResult?.skipped ?? 0) + (rentResult?.skipped ?? 0) + (foreclosureResult?.skipped ?? 0);

    await pool.query(
      `UPDATE crawl_jobs
          SET status = 'completed',
              finished_at = NOW(),
              listings_found = $2,
              error_message = NULL
        WHERE id = $1`,
      [job.id, totalInserted],
    );
    log.info(
      {
        duration_ms: Date.now() - start,
        count: totalCount,
        inserted: totalInserted,
        skipped: totalSkipped,
      },
      'crawl job completed',
    );
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Best-effort failure mark — if the DB is down too, the
    // recycle_stuck_jobs() function will re-pend after 5 min.
    try {
      await pool.query(
        `UPDATE crawl_jobs
            SET status = 'failed',
                finished_at = NOW(),
                error_message = $2
          WHERE id = $1`,
        [job.id, message.slice(0, 1000)],
      );
    } catch (markErr) {
      log.error({ markErr: (markErr as Error).message }, 'failed to mark job as failed');
    }
    log.error({ err: message, duration_ms: Date.now() - start }, 'crawl job failed');
    return true; // we DID process it (failed) — caller shouldn't retry the same id
  }
}

// ---------------------------------------------------------------------------
// Call the scraper FastAPI. Returns its {count, inserted, skipped} blob.
// region_value examples in this project: "Tampa, FL", "33611", etc — the
// scraper's `location` param accepts the same strings n8n was sending.
// ---------------------------------------------------------------------------

interface ScrapeResult {
  count: number;
  inserted: number;
  skipped: number;
}

async function scrape(
  job: CrawlJob,
  listingType: string,
  log: WorkerLogger,
  opts?: { foreclosure?: boolean },
): Promise<ScrapeResult> {
  const url = `${env.SCRAPER_URL.replace(/\/$/, '')}/scrape`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.SCRAPE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        location: job.region_value,
        listing_type: listingType,
        past_days: 30,
        ...(opts?.foreclosure ? { foreclosure: true } : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`scraper ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as Partial<ScrapeResult>;
    return {
      count: Number(json.count) || 0,
      inserted: Number(json.inserted) || 0,
      skipped: Number(json.skipped) || 0,
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      log.warn({ timeout_ms: env.SCRAPE_TIMEOUT_MS }, 'scrape request timed out');
      throw new Error(`scrape timeout after ${env.SCRAPE_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Bounded-concurrency runner. Called from drain AND from notification.
// ---------------------------------------------------------------------------

function runJob(jobId: string, parentLog: WorkerLogger): void {
  if (shuttingDown) {
    parentLog.debug({ job_id: jobId }, 'skipping job during shutdown');
    return;
  }
  // fire-and-track; we don't await here because the notification handler
  // must return quickly to let pg deliver the next NOTIFY.
  inFlight += 1;
  semaphore
    .acquire()
    .then(async () => {
      try {
        await processJob(jobId, parentLog);
      } finally {
        semaphore.release();
        inFlight -= 1;
      }
    })
    .catch((err) => {
      // shouldn't happen — processJob handles its own errors — but
      // belt-and-suspenders.
      parentLog.error({ err: (err as Error).message, job_id: jobId }, 'unexpected runJob error');
      semaphore.release();
      inFlight -= 1;
    });
}

// ---------------------------------------------------------------------------
// Drain: pull pending ids, kick them off via the same runJob path.
// Bounded fetch — we don't load 100k ids in one query.
// ---------------------------------------------------------------------------

const DRAIN_BATCH = 200;

async function drain(parentLog: WorkerLogger): Promise<number> {
  const res = await pool.query<{ id: string }>(
    `SELECT id::text AS id
       FROM crawl_jobs
      WHERE status = 'pending'
      ORDER BY id
      LIMIT $1`,
    [DRAIN_BATCH],
  );
  if (res.rowCount === 0) {
    parentLog.debug('drain: no pending jobs');
    return 0;
  }
  parentLog.info({ count: res.rowCount }, 'drain: dispatching pending jobs');
  for (const row of res.rows) {
    runJob(row.id, parentLog);
  }
  return res.rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// LISTEN client with reconnect loop. The pg `Client` is dedicated to
// LISTEN — we never use it for queries. On disconnect we backoff +
// re-drain so we catch anything enqueued during the gap.
// ---------------------------------------------------------------------------

const CHANNEL = 'crawl_job_enqueued';

async function listenLoop(parentLog: WorkerLogger): Promise<void> {
  let backoff = 1_000; // 1s → 2s → 4s → ... capped
  const MAX_BACKOFF = 60_000;

  while (!shuttingDown) {
    const client = new Client({ connectionString: env.DATABASE_URL });
    let connected = false;

    try {
      await client.connect();
      connected = true;
      backoff = 1_000; // reset on successful connect

      client.on('notification', (msg: Notification) => {
        if (msg.channel !== CHANNEL || !msg.payload) return;
        if (shuttingDown) return;
        runJob(msg.payload, parentLog);
      });

      client.on('error', (err) => {
        // The error event fires before the connection actually dies.
        // We catch it and break the await below by ending the client.
        parentLog.warn({ err: err.message }, 'LISTEN client error');
        void client.end().catch(() => {});
      });

      await client.query(`LISTEN ${CHANNEL}`);
      parentLog.info({ channel: CHANNEL }, 'subscribed to channel');

      // After subscribing, drain again — this closes the race window
      // between "jobs enqueued while we were down" and "LISTEN is now
      // active". Order matters: subscribe FIRST so we don't miss
      // notifications for jobs that land between drain and LISTEN.
      await drain(parentLog);

      // Block on connection lifetime. pg fires 'end' when the server
      // closes the connection; we wait for that to trigger the
      // reconnect path.
      await new Promise<void>((resolve) => {
        client.once('end', () => resolve());
        client.once('error', () => resolve()); // already logged above
      });

      parentLog.warn('LISTEN connection ended, will reconnect');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      parentLog.error({ err: msg, backoff_ms: backoff }, 'LISTEN loop error');
    } finally {
      if (connected) {
        await client.end().catch(() => {});
      }
    }

    if (shuttingDown) break;
    await sleep(backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Graceful shutdown: stop new work, drain in-flight, close, exit.
// ---------------------------------------------------------------------------

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal, in_flight: inFlight }, 'shutdown initiated');

  const deadline = Date.now() + 30_000;
  while (inFlight > 0 && Date.now() < deadline) {
    await sleep(250);
  }
  if (inFlight > 0) {
    log.warn({ in_flight: inFlight }, 'in-flight jobs did not drain within 30s; exiting anyway');
  }
  await pool.end().catch(() => {});
  log.info('shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  log.error({ reason: String(reason) }, 'unhandledRejection');
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log.info(
    {
      concurrency: env.WORKER_CONCURRENCY,
      scraper: env.SCRAPER_URL,
    },
    'crawl worker starting',
  );
  // First-touch drain so any jobs enqueued before the listen loop subscribes
  // get picked up. The listen loop drains again post-subscribe.
  await drain(log).catch((err) => log.error({ err: (err as Error).message }, 'initial drain failed'));
  await listenLoop(log);
}

void main().catch((err) => {
  log.error({ err: (err as Error).message }, 'fatal: worker exiting');
  process.exit(1);
});
