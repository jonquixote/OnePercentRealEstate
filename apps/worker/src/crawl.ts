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
// - reaperLoop() (this file) re-pends jobs stuck in 'processing' past ~1.5×
//   the worst-case job budget — the ACTIVE stuck-job net. (recycle_stuck_jobs()
//   exists in 000_base_schema.sql but is NOT scheduled in prod.)
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
// Concurrency is bounded by the number of runner loops (WORKER_CONCURRENCY),
// each of which owns at most one in-flight job. inFlight is tracked only for
// graceful-shutdown accounting.
// ---------------------------------------------------------------------------

let inFlight = 0;
let shuttingDown = false;

// ---------------------------------------------------------------------------
// Claim the NEXT pending job, atomically. FOR UPDATE SKIP LOCKED lets many
// concurrent runners (and multiple worker instances) pull distinct rows
// without racing. Returns null when the pending queue is empty.
// ---------------------------------------------------------------------------

async function claimNextJob(): Promise<CrawlJob | null> {
  const claim = await pool.query<CrawlJob>(
    `UPDATE crawl_jobs
        SET status = 'processing', started_at = NOW()
      WHERE id = (
        SELECT id FROM crawl_jobs
         WHERE status = 'pending'
         ORDER BY id
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )
      RETURNING id::text AS id, region_type, region_value`,
  );
  return claim.rowCount === 0 ? null : claim.rows[0];
}

// ---------------------------------------------------------------------------
// Process an already-claimed job (status='processing'). Marks it
// completed/failed on the row. Never throws.
// ---------------------------------------------------------------------------

// A "transient" failure means the scraper itself was unreachable (process
// down / OOM-restart / network blip) — the ZIP was never actually attempted
// upstream. These are re-pended (not failed) so no data is lost, and the
// runner backs off. NOTE: a scraper HTTP 4xx/5xx is deliberately NOT
// transient — it means the scraper responded (e.g. a Realtor.com auth block
// surfaced as `scraper 500: ...AuthenticationError...`), which must be
// recorded as a real failure so the block detector can see it.
function isTransientScraperError(msg: string): boolean {
  return /fetch failed|ECONNREFUSED|ECONNRESET|EPIPE|socket hang up|other side closed|network|ENOTFOUND|EAI_AGAIN/i.test(msg);
}

// A "block" error means Realtor.com/homeharvest rejected the request because
// our IP is rate-limited or banned — it surfaces as `scraper 500:
// ...AuthenticationError...` (403/401 upstream). This is distinct from a
// transient (scraper-down) error: the scraper responded, the DATA SOURCE
// refused. When we see this we must STOP hammering (cool-off), not retry hard.
function isBlockError(msg: string): boolean {
  // Word-token signals are unambiguous. Bare status codes (401/403/429) are
  // only treated as a block when they appear in an HTTP/scraper-status context
  // (e.g. "scraper 403:" or "HTTP 429") so a number embedded elsewhere in a
  // truncated error body (a price, an id) can't false-positive.
  return /AuthenticationError|unauthorized|forbidden|too many requests|captcha|access denied|rate.?limit|(?:scraper|status|HTTP)\s*[:=]?\s*(?:401|403|429)\b/i.test(
    msg,
  );
}

type JobOutcome = 'ok' | 'failed' | 'transient' | 'blocked';

async function processClaimedJob(job: CrawlJob, parentLog: WorkerLogger): Promise<JobOutcome> {
  const traceId = newTraceId();
  const log = withTrace(parentLog, traceId, { job_id: job.id });
  const start = Date.now();
  log.info({ region: job.region_value, region_type: job.region_type }, 'claimed crawl job');

  const passErrors: string[] = [];
  const runPass = (name: string, p: Promise<ScrapeResult>): Promise<ScrapeResult | null> =>
    p.catch((err) => {
      const m = (err as Error).message;
      passErrors.push(`${name}: ${m}`);
      log.warn({ err: m }, `${name} scrape failed`);
      return null;
    });

  try {
    // Passes are deliberately SEPARATE and DATE-WINDOWED to keep upstream
    // request volume low — this mirrors the old n8n workflow that ran for
    // months without an IP block. homeharvest silently DROPS the server-side
    // date filter when listing_type is a LIST, so a combined [for_sale,
    // for_rent] query pulls the ENTIRE active inventory of a ZIP (many pages,
    // parallel-paginated) — the exact volume/burstiness that got us blocked
    // in hours. Splitting them back out lets `past_days` bound each pass to a
    // single small page. Each pass also runs with parallel pagination OFF
    // (server-side default) so no ZIP fires a burst of concurrent requests.
    //
    // A short randomized gap (passGap) is inserted between passes so the five
    // requests for a ZIP don't arrive as one tight burst.
    const saleResult = await runPass('for_sale', scrape(job, 'for_sale', log, { pastDays: 30 }));
    await passGap();
    const rentResult = await runPass('for_rent', scrape(job, 'for_rent', log, { pastDays: 30 }));
    await passGap();
    // Distressed inventory via homeharvest's foreclosure filter. The scraper
    // tags these rows sale_type='foreclosure' (source homeharvest_flag) unless
    // its text classifier finds something more specific. foreclosure is a
    // query-wide boolean, so it stays its own windowed pass.
    const foreclosureResult = await runPass('foreclosure', scrape(job, 'for_sale', log, { foreclosure: true, pastDays: 30 }));
    await passGap();
    // Recently sold listings (14-day lookback overlaps the ZIP recycle cycle).
    const soldResult = await runPass('sold', scrape(job, 'sold', log, { pastDays: 14 }));
    await passGap();
    // Pending listings (leading inventory signal). Kept separate because its
    // contingent/pending or_filters are disabled when mixed with other statuses.
    const pendingResult = await runPass('pending', scrape(job, 'pending', log, { pastDays: 14 }));
    // NOTE: PadMapper/Zumper rental source is DISABLED — only homeharvest is
    // active until non-homeharvest scrapers are proven in their own sandbox.

    if (!saleResult && !rentResult && !foreclosureResult && !soldResult && !pendingResult) {
      const combined = passErrors.join(' | ').slice(0, 1000);
      // Every pass failed. Three cases, in priority order:
      //  1. ALL transient (scraper unreachable) — the ZIP was never attempted
      //     upstream; re-pend and let the runner back off.
      //  2. ANY block error (Realtor.com auth/403) — our IP is rate-limited or
      //     banned. Re-pend (don't fail, so the ZIP retries after the block
      //     lifts) and signal the runner to enter a global cool-off instead of
      //     hammering the block (which extends bans).
      //  3. Otherwise a genuine failure — record it so the block detector /
      //     auth fingerprint can see the underlying error(s).
      const allTransient = passErrors.length > 0 && passErrors.every((e) => isTransientScraperError(e));
      if (allTransient) {
        await pool.query(
          `UPDATE crawl_jobs
              SET status = 'pending', started_at = NULL, error_message = $2
            WHERE id = $1`,
          [job.id, `retry (scraper unreachable): ${combined}`.slice(0, 1000)],
        );
        log.warn({ err: combined, duration_ms: Date.now() - start }, 'scraper unreachable; re-pended job for retry');
        return 'transient';
      }
      if (passErrors.some((e) => isBlockError(e))) {
        lastBlockError = combined;
        await pool.query(
          `UPDATE crawl_jobs
              SET status = 'pending', started_at = NULL, error_message = $2
            WHERE id = $1`,
          [job.id, `retry (upstream block): ${combined}`.slice(0, 1000)],
        );
        log.error({ err: combined, duration_ms: Date.now() - start }, 'upstream block detected; re-pended job');
        return 'blocked';
      }
      throw new Error(`all scrape passes failed: ${combined}`);
    }

    const totalCount = (saleResult?.count ?? 0) + (rentResult?.count ?? 0) + (foreclosureResult?.count ?? 0) + (soldResult?.count ?? 0) + (pendingResult?.count ?? 0);
    const totalInserted = (saleResult?.inserted ?? 0) + (rentResult?.inserted ?? 0) + (foreclosureResult?.inserted ?? 0) + (soldResult?.inserted ?? 0) + (pendingResult?.inserted ?? 0);
    const totalSkipped = (saleResult?.skipped ?? 0) + (rentResult?.skipped ?? 0) + (foreclosureResult?.skipped ?? 0) + (soldResult?.skipped ?? 0) + (pendingResult?.skipped ?? 0);

    await pool.query(
      `UPDATE crawl_jobs
          SET status = 'completed',
              finished_at = NOW(),
              listings_found = $2,
              error_message = $3
        WHERE id = $1`,
      // Keep partial-failure context on otherwise-successful jobs so a creeping
      // block (some passes failing) is visible; NULL when everything succeeded.
      [job.id, totalInserted, passErrors.length ? passErrors.join(' | ').slice(0, 1000) : null],
    );
    log.info(
      {
        duration_ms: Date.now() - start,
        count: totalCount,
        inserted: totalInserted,
        skipped: totalSkipped,
        partial_failures: passErrors.length,
      },
      'crawl job completed',
    );
    // A creeping/partial block (some passes blocked, others succeeded) must NOT
    // clear the breaker's escalation — we still got data so we don't pause, but
    // the runner will skip resetBlockCooloff so accumulated backoff survives.
    lastJobHadBlockError = passErrors.some((e) => isBlockError(e));
    return 'ok';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Best-effort failure mark. NOTE: recycle_stuck_jobs() is NOT scheduled in
    // prod; the in-worker reaperLoop() is the active safety net for jobs stuck
    // in 'processing'.
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
    return 'failed';
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
  listingType: string | string[],
  log: WorkerLogger,
  opts?: { foreclosure?: boolean; pastDays?: number; dateFrom?: string; dateTo?: string; source?: string },
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
        past_days: opts?.pastDays ?? 30,
        ...(opts?.foreclosure ? { foreclosure: true } : {}),
        ...(opts?.dateFrom ? { date_from: opts.dateFrom } : {}),
        ...(opts?.dateTo ? { date_to: opts.dateTo } : {}),
        ...(opts?.source ? { source: opts.source } : {}),
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
// Continuous claim loop.
//
// The crawl_jobs backlog is a large STATIC seed (one row per US ZIP) that the
// recycle trigger re-queues forever — there is no stream of live INSERTs, so a
// NOTIFY-only design starves the moment the first drained batch is processed
// (which is exactly how the crawler silently stalled on 2026-07-14 with 83k
// rows still pending). Each runner therefore POLLS claimNextJob() continuously;
// LISTEN is kept only as a low-latency wakeup for the occasional live enqueue.
//
// N runners (= WORKER_CONCURRENCY) each own at most one in-flight job, so the
// number of concurrent scrapes is bounded by the runner count itself.
// ---------------------------------------------------------------------------

const IDLE_POLL_MS = 2_000; // re-check the queue at least this often when idle
const SCRAPER_DOWN_BACKOFF_MS = 5_000; // pause a runner after a scraper-unreachable job

// ---------------------------------------------------------------------------
// Politeness pacing. The old n8n workflow survived for months because it hit
// Realtor.com gently: one ZIP per ~30s schedule tick, serialized, windowed.
// The continuous drain loop removed all pacing, which (with full-inventory
// combined passes) tripped Realtor's per-IP bot heuristics in hours. We
// restore two things:
//   1. A GLOBAL minimum interval between job STARTS (across all runners), with
//      jitter, so ZIPs are spaced out like the old schedule tick.
//   2. A short randomized gap BETWEEN the passes of one ZIP, so its five
//      requests don't arrive as a single tight burst.
// ---------------------------------------------------------------------------

let nextJobEarliestStart = 0; // epoch ms; global gate shared by all runners

function jitter(maxMs: number): number {
  return Math.floor(Math.random() * Math.max(0, maxMs));
}

// Block a runner until the global pacing gate opens, then reserve the next
// slot. Serializes naturally at WORKER_CONCURRENCY=1; with >1 runner it still
// spaces job starts because the gate is shared module state.
async function paceJobStart(): Promise<void> {
  while (!shuttingDown) {
    const now = Date.now();
    if (now >= nextJobEarliestStart) {
      nextJobEarliestStart = now + env.CRAWL_JOB_MIN_INTERVAL_MS + jitter(env.CRAWL_JOB_MIN_INTERVAL_MS >> 2);
      return;
    }
    await sleep(Math.min(nextJobEarliestStart - now, 1_000));
  }
}

// Randomized pause between the passes of a single ZIP.
function passGap(): Promise<void> {
  return sleep(jitter(env.CRAWL_PASS_JITTER_MS));
}

// ---------------------------------------------------------------------------
// Block circuit breaker. When Realtor.com blocks our IP, continuing to send
// requests only extends the ban. On a blocked outcome we pause ALL claiming
// for a cool-off (exponential backoff up to a cap), then let a single job act
// as a probe: if it succeeds we reset, if it blocks again the cool-off grows.
// This lets us "apply fixes and wait out the block" safely and resume
// automatically when the IP frees up.
// ---------------------------------------------------------------------------

const BLOCK_COOLOFF_MAX_MS = 4 * 60 * 60 * 1000; // 4h cap
let blockedUntil = 0; // epoch ms; runners refuse to claim before this
let currentCooloffMs = 0; // set from env at boot
let lastBlockError = ''; // most recent block error message (for block-state row)
let lastJobHadBlockError = false; // last 'ok' job had a partial block among its passes

function enterBlockCooloff(parentLog: WorkerLogger): void {
  // Dedupe: with WORKER_CONCURRENCY>1 several in-flight jobs fail at once when
  // the IP is blocked and each returns 'blocked'. Treat any block that lands
  // while we're already paused as the SAME event, so a single block can't
  // double-extend blockedUntil or over-escalate the backoff. (Also absorbs the
  // post-cool-off probe storm.)
  if (Date.now() < blockedUntil) return;
  if (currentCooloffMs === 0) currentCooloffMs = env.CRAWL_BLOCK_COOLOFF_MS;
  blockedUntil = Date.now() + currentCooloffMs;
  parentLog.error(
    { cooloff_ms: currentCooloffMs, resume_at: new Date(blockedUntil).toISOString() },
    'upstream block detected; crawling paused for cool-off',
  );
  // Persist the block state so the postgres-exporter crawler_health query (and
  // the CrawlerBlockCooloff alert) can see we're blocked even though blocked
  // jobs are re-pended rather than left as 'failed'. Fire-and-forget: the
  // breaker's timing must not depend on the DB write succeeding.
  void pool
    .query(
      `UPDATE crawler_block_state
          SET blocked_at = now(),
              cooloff_until = $1,
              consecutive_blocks = consecutive_blocks + 1,
              last_error = $2,
              updated_at = now()
        WHERE id = 1`,
      [new Date(blockedUntil).toISOString(), lastBlockError.slice(0, 500) || null],
    )
    .catch((err) => parentLog.warn({ err: (err as Error).message }, 'failed to record block state'));
  currentCooloffMs = Math.min(currentCooloffMs * 2, BLOCK_COOLOFF_MAX_MS);
}

function resetBlockCooloff(parentLog: WorkerLogger): void {
  const wasBlocked = blockedUntil !== 0;
  blockedUntil = 0;
  currentCooloffMs = env.CRAWL_BLOCK_COOLOFF_MS;
  if (wasBlocked) {
    parentLog.info('probe succeeded after block; cool-off cleared, resuming normal pace');
    void pool
      .query(
        `UPDATE crawler_block_state
            SET blocked_at = NULL, cooloff_until = NULL, consecutive_blocks = 0,
                last_error = NULL, updated_at = now()
          WHERE id = 1`,
      )
      .catch((err) => parentLog.warn({ err: (err as Error).message }, 'failed to clear block state'));
  }
}

// Rehydrate the breaker from the DB at boot. The cool-off lives in module
// memory, so without this a crash/OOM/redeploy DURING a cool-off would resume
// crawling immediately into a still-blocked IP — re-blocking and re-escalating,
// the exact thing the breaker exists to prevent. consecutive_blocks lets us
// restore the escalated backoff too (matches the in-memory value after N
// blocks: base * 2^N, capped).
async function restoreBlockState(parentLog: WorkerLogger): Promise<void> {
  try {
    const res = await pool.query<{ cooloff_until: Date | null; consecutive_blocks: number }>(
      `SELECT cooloff_until, consecutive_blocks FROM crawler_block_state WHERE id = 1`,
    );
    const row = res.rows[0];
    if (!row?.cooloff_until) return;
    const n = Math.max(0, Number(row.consecutive_blocks) || 0);
    currentCooloffMs = Math.min(env.CRAWL_BLOCK_COOLOFF_MS * 2 ** n, BLOCK_COOLOFF_MAX_MS);
    const until = new Date(row.cooloff_until).getTime();
    if (until > Date.now()) {
      blockedUntil = until;
      parentLog.warn(
        { resume_at: new Date(until).toISOString(), consecutive_blocks: n },
        'restored active block cool-off from DB; crawling paused until it expires',
      );
    }
  } catch (err) {
    parentLog.warn({ err: (err as Error).message }, 'failed to restore block state at boot');
  }
}

// Wakeup fan-out: idle runners park here; a NOTIFY (or the idle timer) releases
// them so they immediately re-check the queue instead of sleeping the full poll.
let wakeupWaiters: Array<() => void> = [];

function wakeupAll(): void {
  const waiters = wakeupWaiters;
  wakeupWaiters = [];
  for (const w of waiters) w();
}

function waitForWork(timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const release = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      wakeupWaiters = wakeupWaiters.filter((w) => w !== release);
      resolve();
    }, timeoutMs);
    wakeupWaiters.push(release);
  });
}

async function runnerLoop(id: number, parentLog: WorkerLogger): Promise<void> {
  while (!shuttingDown) {
    // Respect a global block cool-off before doing anything else.
    if (Date.now() < blockedUntil) {
      await sleep(Math.min(blockedUntil - Date.now(), 30_000));
      continue;
    }

    // Pace job starts to mimic the old n8n schedule tick (politeness).
    await paceJobStart();
    if (shuttingDown) break;

    let job: CrawlJob | null = null;
    try {
      job = await claimNextJob();
    } catch (err) {
      parentLog.warn({ err: (err as Error).message, runner: id }, 'claim query failed; backing off');
      await sleep(IDLE_POLL_MS);
      continue;
    }

    if (!job) {
      // Queue empty (or every pending row locked by a peer) — park until a
      // NOTIFY or the idle timer, then re-check.
      await waitForWork(IDLE_POLL_MS);
      continue;
    }

    inFlight += 1;
    try {
      const outcome = await processClaimedJob(job, parentLog);
      if (outcome === 'transient') {
        // Scraper was unreachable — the job was re-pended. Back off so we don't
        // tight-loop and burn through the whole backlog while it's down.
        await sleep(SCRAPER_DOWN_BACKOFF_MS);
      } else if (outcome === 'blocked') {
        // Realtor.com blocked our IP — pause ALL runners for a cool-off.
        enterBlockCooloff(parentLog);
      } else if (outcome === 'ok') {
        // A clean success clears any prior block cool-off escalation — but a
        // PARTIAL block (data returned yet some passes blocked) must not, or a
        // flapping block would keep resetting the backoff.
        if (!lastJobHadBlockError) resetBlockCooloff(parentLog);
      }
    } finally {
      inFlight -= 1;
    }
  }
}

// ---------------------------------------------------------------------------
// LISTEN client with reconnect loop — a low-latency wakeup only. The runner
// loops are the source of truth for pulling work; a NOTIFY just wakes any
// parked runner early. On disconnect we reconnect with backoff.
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
        if (msg.channel !== CHANNEL) return;
        if (shuttingDown) return;
        wakeupAll(); // wake parked runners; they claim atomically themselves
      });

      client.on('error', (err) => {
        parentLog.warn({ err: err.message }, 'LISTEN client error');
        void client.end().catch(() => {});
      });

      await client.query(`LISTEN ${CHANNEL}`);
      parentLog.info({ channel: CHANNEL }, 'subscribed to channel (wakeup only)');

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
// Stuck-job reaper. A worker restart/crash (or an OOM'd scraper hanging a
// request) leaves the in-flight row stuck in 'processing' forever — the claim
// loop only ever picks up 'pending', so without this those ZIPs silently drop
// out of coverage. Periodically re-pend anything that has been 'processing'
// longer than the longest a legitimate job could take (5 passes ×
// SCRAPE_TIMEOUT_MS) plus a safety margin, so we never reclaim a live job.
// ---------------------------------------------------------------------------

const REAP_INTERVAL_MS = 5 * 60 * 1000;

function stuckThresholdMinutes(): number {
  const maxJobMs = env.SCRAPE_TIMEOUT_MS * 5; // 5 passes, worst case
  return Math.ceil((maxJobMs * 1.5) / 60000) + 5; // 1.5× budget + 5 min margin
}

async function reapStuckJobs(parentLog: WorkerLogger): Promise<void> {
  const mins = stuckThresholdMinutes();
  try {
    const res = await pool.query(
      `UPDATE crawl_jobs
          SET status = 'pending', started_at = NULL
        WHERE status = 'processing'
          AND started_at < now() - make_interval(mins => $1)`,
      [mins],
    );
    if (res.rowCount && res.rowCount > 0) {
      parentLog.warn({ reaped: res.rowCount, threshold_min: mins }, 'reaped stuck processing jobs');
      wakeupAll();
    }
  } catch (err) {
    parentLog.warn({ err: (err as Error).message }, 'stuck-job reaper failed');
  }
}

async function reaperLoop(parentLog: WorkerLogger): Promise<void> {
  await reapStuckJobs(parentLog); // sweep once at startup to clear prior-crash orphans
  while (!shuttingDown) {
    await sleep(REAP_INTERVAL_MS);
    if (shuttingDown) break;
    await reapStuckJobs(parentLog);
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown: stop new work, drain in-flight, close, exit.
// ---------------------------------------------------------------------------

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal, in_flight: inFlight }, 'shutdown initiated');
  wakeupAll(); // release any parked runners so they observe shuttingDown

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
  const concurrency = Math.max(1, env.WORKER_CONCURRENCY);
  currentCooloffMs = env.CRAWL_BLOCK_COOLOFF_MS; // seed the block-breaker backoff
  await restoreBlockState(log); // rehydrate an in-progress cool-off across restarts
  log.info(
    {
      concurrency,
      scraper: env.SCRAPER_URL,
      job_interval_ms: env.CRAWL_JOB_MIN_INTERVAL_MS,
      block_cooloff_ms: env.CRAWL_BLOCK_COOLOFF_MS,
    },
    'crawl worker starting',
  );

  // Launch N runner loops that continuously claim + process pending jobs,
  // plus the LISTEN loop that wakes parked runners on live enqueues. The
  // runners are the source of truth for pulling work — they never starve on
  // the static seed backlog the way a NOTIFY-only design did.
  const runners = Array.from({ length: concurrency }, (_, i) => runnerLoop(i, log));
  await Promise.all([listenLoop(log), reaperLoop(log), ...runners]);
}

void main().catch((err) => {
  log.error({ err: (err as Error).message }, 'fatal: worker exiting');
  process.exit(1);
});
