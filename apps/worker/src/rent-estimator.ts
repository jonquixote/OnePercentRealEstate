// Async rent estimator worker. Replaces the synchronous
// `set_smart_rent_estimate` BEFORE INSERT trigger that used to pay the
// 30–80ms triangulation cost on every listing write.
//
// Lifecycle mirrors crawl.ts deliberately — same drain-then-LISTEN
// pattern, same shutdown semantics — so anyone reading either file finds
// the same shape.
//
// 1. On boot, drain `listings WHERE rent_calc_status='pending'` in
//    bounded batches (RENT_BACKFILL_BATCH). This catches the ~1.1k rows
//    seeded by migration 2026_06_03_rent_calc_async.sql plus any inserts
//    that landed during downtime.
// 2. LISTEN rent_job_enqueued — payload is the listing id.
// 3. For each id: load the listing row, POST to services/ml /predict,
//    write back estimated_rent + rent_model_version + status='done', and
//    append a row to rent_predictions_audit.
// 4. On any failure: status='failed', log structured error, keep going.
// 5. SIGTERM/SIGINT: stop accepting new work, drain in-flight, exit.

import { Client, Pool, type Notification } from 'pg';
import { loadEnv } from './env.js';
import { getLogger, newTraceId, withTrace, type WorkerLogger } from './logger.js';
import { Redis } from 'ioredis';
import { CircuitBreaker, classifyMlError } from './ml-errors.js';

const env = loadEnv();
const log = getLogger(env.LOG_LEVEL);

// ---------------------------------------------------------------------------
// Redis for cache busting after rent calculations
// ---------------------------------------------------------------------------

let redisClient: Redis | null = null;

function getRedis(): Redis | null {
  if (!env.REDIS_URL) return null;
  if (!redisClient) {
    redisClient = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      retryStrategy(times: number) {
        return Math.min(times * 200, 5000);
      },
      lazyConnect: true,
    });
    redisClient.on('error', (err: Error) => {
      log.warn({ err: err.message }, 'redis connection error');
    });
  }
  return redisClient;
}

// Counter to batch cache-busting (every N completions)
let completionsSinceLastBust = 0;
const BUST_EVERY = 25;

async function bustFrontendCaches(): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    // Delete known cache keys so the frontend fetches fresh data
    await r.del('home:stats:v1');
    // Bust featured deals cache (pattern: home:featured:v1:*)
    const featuredKeys = await r.keys('home:featured:v1:*');
    if (featuredKeys.length > 0) {
      await r.del(...featuredKeys);
    }
    // Increment the version counter so property list caches expire
    await r.incr('props:version');
    log.info('busted frontend caches after rent completions');
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'failed to bust frontend caches');
  }
}

// Rentability is decided by the DB is_rentable() function (property_type_rules)
// — the single source of truth. Resolved per row in loadListing(), no TS list.

// Payload shape sent to the FastAPI shim. Mirrors the columns the
// calculate_smart_rent function needs; zip_code is pulled from
// raw_data->>'zip_code' to stay aligned with the legacy SQL trigger.
interface ListingPayload {
  readonly listing_id: number;
  readonly address: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly zip_code: string | null;
  readonly bedrooms: number | null;
  readonly bathrooms: number | null;
  readonly sqft: number | null;
  readonly year_built: number | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly property_type: string | null;
  readonly is_rentable: boolean | null;
  readonly hoa_fee: number | null;
  readonly lot_sqft: number | null;
}

interface PredictResponse {
  readonly predicted_rent: number;
  readonly model_version: string;
  readonly features_hash: string;
  // Wave 2: quantile band, present when the v1 model served the request.
  readonly rent_low?: number | null;
  readonly rent_high?: number | null;
}

interface BatchScoredItem {
  readonly listing_id: number;
  readonly predicted_rent: number;
  readonly rent_low?: number | null;
  readonly rent_high?: number | null;
  readonly model_version: string;
  readonly features_hash: string;
}

// ---------------------------------------------------------------------------
// Pool
// ---------------------------------------------------------------------------

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: Math.max(env.RENT_WORKER_CONCURRENCY + 2, 4),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  log.warn({ err: err.message }, 'pool idle client error');
});

// ---------------------------------------------------------------------------
// Bounded concurrency. Identical pattern to crawl.ts — duplicated rather
// than extracted because pulling a shared utility module is the kind of
// premature abstraction that bites later. Two callers, both simple,
// living next door — fine.
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
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.available += 1;
    }
  }
}

const semaphore = new Semaphore(env.RENT_WORKER_CONCURRENCY);
let inFlight = 0;
let shuttingDown = false;

// Breaker shared by the drain loop and NOTIFY-driven jobs. When the ML
// service flaps (its OOM restart loop was the P1 incident on 2026-07-05),
// we stop pulling work instead of converting the backlog into permanent
// 'failed' rows.
const breaker = new CircuitBreaker(
  5,       // consecutive transient failures before opening
  30_000,  // first open window
  300_000, // cap
);

// ---------------------------------------------------------------------------
// processJob: load row → call ML → write back. Each step has its own
// failure handling so we never leave a row pinned in 'pending' silently.
// ---------------------------------------------------------------------------

async function loadListing(listingId: string, parentLog: WorkerLogger): Promise<ListingPayload | null> {
  // SELECT pulls only what the ML shim needs. zip_code lives in raw_data
  // for legacy rows; the dedicated `zip_code` column is populated by the
  // newer scraper writes.
  const res = await pool.query<{
    id: number;
    address: string | null;
    city: string | null;
    state: string | null;
    zip_code_col: string | null;
    zip_code_raw: string | null;
    bedrooms: number | null;
    bathrooms: number | null;
    sqft: number | null;
    year_built: number | null;
    latitude: number | null;
    longitude: number | null;
    property_type: string | null;
    is_rentable: boolean | null;
    hoa_fee: string | null;
    lot_size_acres: string | null;
  }>(
    `SELECT id,
            address,
            city,
            state,
            zip_code AS zip_code_col,
            (raw_data->>'zip_code')::text AS zip_code_raw,
            bedrooms,
            bathrooms,
            sqft,
            year_built,
            latitude,
            longitude,
            property_type,
            public.is_rentable(property_type) AS is_rentable,
            hoa_fee,
            lot_size_acres
       FROM listings
      WHERE id = $1`,
    [listingId],
  );

  if (res.rowCount === 0) {
    parentLog.warn({ listing_id: listingId }, 'listing vanished before rent calc');
    return null;
  }

  const r = res.rows[0];
  return {
    listing_id: r.id,
    address: r.address,
    city: r.city,
    state: r.state,
    zip_code: r.zip_code_col ?? r.zip_code_raw,
    bedrooms: r.bedrooms,
    bathrooms: r.bathrooms != null ? Number(r.bathrooms) : null,
    sqft: r.sqft,
    year_built: r.year_built,
    latitude: r.latitude != null ? Number(r.latitude) : null,
    longitude: r.longitude != null ? Number(r.longitude) : null,
    property_type: r.property_type,
    is_rentable: r.is_rentable,
    hoa_fee: r.hoa_fee != null ? Number(r.hoa_fee) : null,
    lot_sqft: r.lot_size_acres != null ? Number(r.lot_size_acres) * 43_560 : null,
  };
}

async function callMlService(payload: ListingPayload, parentLog: WorkerLogger): Promise<PredictResponse> {
  const url = `${env.ML_URL.replace(/\/$/, '')}/predict`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.RENT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`ml ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as Partial<PredictResponse>;
    if (typeof json.predicted_rent !== 'number' || !Number.isFinite(json.predicted_rent)) {
      throw new Error(`ml returned invalid predicted_rent: ${String(json.predicted_rent)}`);
    }
    if (typeof json.model_version !== 'string' || json.model_version.length === 0) {
      throw new Error('ml returned missing model_version');
    }
    return {
      predicted_rent: json.predicted_rent,
      model_version: json.model_version,
      features_hash: typeof json.features_hash === 'string' ? json.features_hash : '',
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      parentLog.warn({ timeout_ms: env.RENT_TIMEOUT_MS }, 'ml request timed out');
      throw new Error(`ml timeout after ${env.RENT_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function markDone(
  listingId: number,
  predictedRent: number,
  modelVersion: string,
  features: ListingPayload,
  rentLow?: number | null,
  rentHigh?: number | null,
): Promise<void> {
  // Single transaction: update listings + append audit row. If either
  // half fails we want to roll back so the row stays 'pending' for retry
  // rather than getting orphaned in audit without a stamped estimate.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE listings
          SET estimated_rent = $2,
              rent_calc_status = 'done',
              rent_model_version = $3,
              rent_low = $4,
              rent_high = $5,
              updated_at = NOW()
        WHERE id = $1`,
      [listingId, predictedRent, modelVersion, rentLow ?? null, rentHigh ?? null],
    );
    await client.query(
      `INSERT INTO rent_predictions_audit (listing_id, model_version, predicted_rent, features)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [listingId, modelVersion, predictedRent, JSON.stringify(features)],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function markFailed(listingId: number, reason: string): Promise<void> {
  await pool.query(
    `UPDATE listings
        SET rent_calc_status = 'failed',
            updated_at = NOW()
      WHERE id = $1`,
    [listingId],
  );
  log.error({ listing_id: listingId, reason: reason.slice(0, 500) }, 'rent calc failed');
}

async function processListing(listingId: string, parentLog: WorkerLogger): Promise<void> {
  const traceId = newTraceId();
  const jobLog = withTrace(parentLog, traceId, { listing_id: listingId });
  const start = Date.now();

  const payload = await loadListing(listingId, jobLog);
  if (!payload) {
    // Row was deleted between enqueue and processing — nothing to do.
    return;
  }

  if (payload.latitude == null || payload.longitude == null) {
    // calculate_smart_rent needs lat/lon to do any of its work. Skip
    // gracefully — mark failed so we don't loop forever on the same
    // unenrichable row when the trigger gets retriggered by an update.
    await markFailed(payload.listing_id, 'missing lat/lon');
    return;
  }

  // Skip ML call for non-rentable property types — set rent to 0 directly.
  // Single source of truth: DB is_rentable() (property_type_rules), resolved in loadListing.
  if (payload.is_rentable === false) {
    await markDone(payload.listing_id, 0, 'non_rentable_skip', payload);
    jobLog.info({ property_type: payload.property_type }, 'skipped non-rentable type');
    completionsSinceLastBust++;
    if (completionsSinceLastBust >= BUST_EVERY) {
      completionsSinceLastBust = 0;
      await bustFrontendCaches();
    }
    return;
  }

  // Two separate try/catches on purpose: classifyMlError() + the breaker
  // exist to measure *ML service* health. A markDone() failure is a DB
  // write problem — classifying it would falsely trip the ML breaker
  // (default classification is 'transient') and pause the drain for an
  // outage that isn't happening.
  let prediction: PredictResponse;
  try {
    prediction = await callMlService(payload, jobLog);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const kind = classifyMlError(message);
    if (kind === 'transient') {
      // Row stays 'pending' — the drain loop will retry it once the
      // dependency heals. Marking these 'failed' is how 171K rows got
      // stranded before 2026-07-05.
      breaker.recordTransientFailure();
      jobLog.warn(
        { err: message, duration_ms: Date.now() - start },
        'rent calc transient failure — row stays pending',
      );
      return;
    }
    try {
      await markFailed(payload.listing_id, message);
    } catch (markErr) {
      jobLog.error(
        { markErr: (markErr as Error).message },
        'failed to mark rent_calc_status=failed (will be retried on next NOTIFY/update)',
      );
    }
    jobLog.error({ err: message, duration_ms: Date.now() - start }, 'rent calc errored');
    return;
  }

  // ML answered — record the success against the breaker regardless of
  // what the DB write does next.
  breaker.recordSuccess();

  try {
    await markDone(
      payload.listing_id,
      prediction.predicted_rent,
      prediction.model_version,
      payload,
      prediction.rent_low,
      prediction.rent_high,
    );
    jobLog.info(
      {
        duration_ms: Date.now() - start,
        predicted_rent: prediction.predicted_rent,
        model_version: prediction.model_version,
      },
      'rent calc done',
    );

    // Bust frontend caches periodically
    completionsSinceLastBust++;
    if (completionsSinceLastBust >= BUST_EVERY) {
      completionsSinceLastBust = 0;
      await bustFrontendCaches();
    }
  } catch (err) {
    // DB write-back failed. The row is still 'pending' (markDone is
    // transactional), so the drain loop retries it naturally. Not an ML
    // signal — the breaker is untouched. markFailed would also be a DB
    // write into the same unhealthy DB; don't bother.
    jobLog.error(
      { err: (err as Error).message, duration_ms: Date.now() - start },
      'rent write-back failed — row stays pending for retry',
    );
  }
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

function runJob(listingId: string, parentLog: WorkerLogger): void {
  if (shuttingDown) {
    parentLog.debug({ listing_id: listingId }, 'skipping job during shutdown');
    return;
  }
  inFlight += 1;
  semaphore
    .acquire()
    .then(async () => {
      try {
        await processListing(listingId, parentLog);
      } finally {
        semaphore.release();
        inFlight -= 1;
      }
    })
    .catch((err) => {
      parentLog.error({ err: (err as Error).message, listing_id: listingId }, 'unexpected runJob error');
      semaphore.release();
      inFlight -= 1;
    });
}

// ---------------------------------------------------------------------------
// Wave 2: batch drain. One SELECT for a page of pending rows (with the
// features the model wants), one POST to ml /predict_batch, one bulk
// UPDATE + one bulk audit INSERT. Replaces the per-row HTTP loop for the
// backlog; the LISTEN path still handles realtime single inserts.
//
// Row taxonomy inside a page:
//   - non-rentable property types  -> settled in SQL (NULL rent, 'done',
//     'non_rentable_skip') without touching ML. NULL, not 0: Wave 2
//     retires the rent=0 encoding.
//   - rentable, missing lat/lng    -> 'failed' in SQL (permanent, same
//     semantics as the single-row path).
//   - rentable, scoreable          -> ML batch; rows the ML response
//     skips are marked 'failed' so they can't recycle forever.
// ---------------------------------------------------------------------------

interface BatchRow {
  readonly id: string;
  readonly address: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly zip_code: string | null;
  readonly bedrooms: number | null;
  readonly bathrooms: string | null;
  readonly sqft: number | null;
  readonly year_built: number | null;
  readonly latitude: string | null;
  readonly longitude: string | null;
  readonly property_type: string | null;
  readonly hoa_fee: string | null;
  readonly lot_size_acres: string | null;
}

async function drainBatch(parentLog: WorkerLogger): Promise<number> {
  // 1. Settle non-rentables + geometry-less rows in SQL (bounded pages).
  const settled = await pool.query(
    `WITH nr AS (
       SELECT id FROM listings
        WHERE rent_calc_status = 'pending' AND NOT public.is_rentable(property_type)
        ORDER BY id LIMIT $1
     )
     UPDATE listings l
        SET estimated_rent = NULL, rent_low = NULL, rent_high = NULL,
            rent_calc_status = 'done', rent_model_version = 'non_rentable_skip',
            updated_at = NOW()
       FROM nr WHERE l.id = nr.id`,
    [env.RENT_BATCH_SIZE],
  );
  const noGeo = await pool.query(
    `WITH ng AS (
       SELECT id FROM listings
        WHERE rent_calc_status = 'pending' AND public.is_rentable(property_type)
          AND (latitude IS NULL OR longitude IS NULL)
        ORDER BY id LIMIT $1
     )
     UPDATE listings l
        SET rent_calc_status = 'failed', updated_at = NOW()
       FROM ng WHERE l.id = ng.id`,
    [env.RENT_BATCH_SIZE],
  );
  if (noGeo.rowCount && noGeo.rowCount > 0) {
    parentLog.warn({ noGeo: noGeo.rowCount }, `marked ${noGeo.rowCount} no-geo listings as failed`);
  }

  // 2. Pull a scoreable page with features.
  const page = await pool.query<BatchRow>(
    `SELECT id::text AS id, address, city, state,
            zip_code, bedrooms, bathrooms, sqft, year_built,
            latitude, longitude, property_type, hoa_fee, lot_size_acres
       FROM listings
      WHERE rent_calc_status = 'pending'
        AND public.is_rentable(property_type)
        AND latitude IS NOT NULL AND longitude IS NOT NULL
      ORDER BY id
      LIMIT $1`,
    [env.RENT_BATCH_SIZE],
  );
  const sqlSettled = (settled.rowCount ?? 0) + (noGeo.rowCount ?? 0);
  if (page.rowCount === 0) {
    return sqlSettled;
  }

  const items = page.rows.map((r) => ({
    listing_id: Number(r.id),
    address: r.address,
    city: r.city,
    state: r.state,
    zip_code: r.zip_code,
    bedrooms: r.bedrooms,
    bathrooms: r.bathrooms != null ? Number(r.bathrooms) : null,
    sqft: r.sqft,
    year_built: r.year_built,
    latitude: r.latitude != null ? Number(r.latitude) : null,
    longitude: r.longitude != null ? Number(r.longitude) : null,
    property_type: r.property_type,
    hoa_fee: r.hoa_fee != null ? Number(r.hoa_fee) : null,
    lot_sqft: r.lot_size_acres != null ? Number(r.lot_size_acres) * 43_560 : null,
  }));

  // 3. One HTTP call for the page.
  let results: BatchScoredItem[];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.RENT_TIMEOUT_MS * 4);
    try {
      const res = await fetch(`${env.ML_URL.replace(/\/$/, '')}/predict_batch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`ml ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
      }
      results = ((await res.json()) as { results: BatchScoredItem[] }).results ?? [];
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // One batch failure = ONE breaker event (not 500) — rows stay pending.
    breaker.recordTransientFailure();
    parentLog.warn({ err: message, batch: items.length }, 'batch scoring transient failure');
    return sqlSettled;
  }
  breaker.recordSuccess();

  // 4. Bulk write-back in one transaction.
  const scored = results.filter((s) => Number.isFinite(s.predicted_rent));
  const scoredIds = new Set(scored.map((s) => s.listing_id));
  const skipped = items.filter((i) => !scoredIds.has(i.listing_id)).map((i) => i.listing_id);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (scored.length > 0) {
      await client.query(
        `UPDATE listings AS l
            SET estimated_rent = v.rent,
                rent_low = v.lo,
                rent_high = v.hi,
                rent_calc_status = 'done',
                rent_model_version = v.mv,
                updated_at = NOW()
           FROM (
             SELECT unnest($1::bigint[])  AS id,
                    unnest($2::numeric[]) AS rent,
                    unnest($3::numeric[]) AS lo,
                    unnest($4::numeric[]) AS hi,
                    unnest($5::text[])    AS mv
           ) v
          WHERE l.id = v.id`,
        [
          scored.map((s) => s.listing_id),
          scored.map((s) => s.predicted_rent),
          scored.map((s) => s.rent_low ?? null),
          scored.map((s) => s.rent_high ?? null),
          scored.map((s) => s.model_version),
        ],
      );
      // Map items by listing_id so features are emitted in scored order,
      // matching listing_id / model_version / predicted_rent arrays.
      const itemMap = new Map<number, (typeof items)[number]>(
        items.map((i) => [i.listing_id, i]),
      );
      await client.query(
        `INSERT INTO rent_predictions_audit (listing_id, model_version, predicted_rent, features)
         SELECT unnest($1::bigint[]), unnest($2::text[]), unnest($3::numeric[]), unnest($4::jsonb[])`,
        [
          scored.map((s) => s.listing_id),
          scored.map((s) => s.model_version),
          scored.map((s) => s.predicted_rent),
          scored.map((s) => JSON.stringify(itemMap.get(s.listing_id) ?? null)),
        ],
      );
    }
    if (skipped.length > 0) {
      await client.query(
        `UPDATE listings SET rent_calc_status = 'failed', updated_at = NOW()
          WHERE id = ANY($1::bigint[])`,
        [skipped],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    // DB write problem, not an ML signal (same taxonomy as the single-row
    // path) — rows stay pending, no breaker involvement.
    parentLog.error({ err: (err as Error).message }, 'batch write-back failed — rows stay pending');
    return sqlSettled;
  } finally {
    client.release();
  }

  parentLog.info(
    { scored: scored.length, skipped: skipped.length, sql_settled: sqlSettled },
    'batch drained',
  );
  return sqlSettled + scored.length + skipped.length;
}

// ---------------------------------------------------------------------------
// Continuous drain. The one-shot drain-on-connect only ever dispatched
// RENT_BACKFILL_BATCH rows per process lifetime — with 613K pending rows
// that meant the backlog was structurally never drained. This loop pulls
// a batch, waits for it to fully settle (drain() re-SELECTs 'pending', so
// overlapping batches would double-dispatch the same rows), then pulls
// the next. Empty queue or an open breaker -> sleep and re-check.
// ---------------------------------------------------------------------------

async function drainForever(parentLog: WorkerLogger): Promise<void> {
  while (!shuttingDown) {
    if (breaker.isOpen()) {
      const waitMs = Math.max(breaker.msUntilClose(), 1_000);
      parentLog.warn({ wait_ms: waitMs }, 'breaker open — pausing drain');
      await sleep(waitMs);
      continue;
    }

    let processed = 0;
    try {
      // Wave 2: bulk scoring path. drainBatch awaits its own write-back,
      // so there is no in-flight settling to wait for — only the LISTEN
      // singles share the semaphore.
      processed = await drainBatch(parentLog);
    } catch (err) {
      parentLog.error({ err: (err as Error).message }, 'drain loop error');
      await sleep(5_000);
      continue;
    }

    if (processed === 0) {
      await sleep(env.RENT_DRAIN_INTERVAL_MS);
      continue;
    }
  }
}

// ---------------------------------------------------------------------------
// LISTEN client with reconnect loop. Identical shape to crawl.ts.
// ---------------------------------------------------------------------------

const CHANNEL = 'rent_job_enqueued';

async function listenLoop(parentLog: WorkerLogger): Promise<void> {
  let backoff = 1_000;
  const MAX_BACKOFF = 60_000;

  while (!shuttingDown) {
    const client = new Client({ connectionString: env.DATABASE_URL });
    let connected = false;

    try {
      await client.connect();
      connected = true;
      backoff = 1_000;

      client.on('notification', (msg: Notification) => {
        if (msg.channel !== CHANNEL || !msg.payload) return;
        if (shuttingDown) return;
        runJob(msg.payload, parentLog);
      });

      client.on('error', (err) => {
        parentLog.warn({ err: err.message }, 'LISTEN client error');
        void client.end().catch(() => {});
      });

      await client.query(`LISTEN ${CHANNEL}`);
      parentLog.info({ channel: CHANNEL }, 'subscribed to channel');

      // Backlog draining is owned by drainForever() (started in main()).
      // This loop only keeps the LISTEN subscription alive for realtime
      // NOTIFYs on new inserts.

      // Block until the connection ends, then loop to reconnect.
      await new Promise<void>((resolve) => {
        client.once('end', () => resolve());
        client.once('error', () => resolve());
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
// Shutdown
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
    log.warn({ in_flight: inFlight }, 'in-flight rent jobs did not drain within 30s; exiting anyway');
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
      concurrency: env.RENT_WORKER_CONCURRENCY,
      ml: env.ML_URL,
      backfill_batch: env.RENT_BACKFILL_BATCH,
      drain_interval_ms: env.RENT_DRAIN_INTERVAL_MS,
    },
    'rent-estimator worker starting',
  );
  // LISTEN handles realtime inserts; drainForever owns the backlog.
  // They share the semaphore, so total concurrency stays bounded.
  await Promise.all([listenLoop(log), drainForever(log)]);
}

void main().catch((err) => {
  log.error({ err: (err as Error).message }, 'fatal: rent-estimator exiting');
  process.exit(1);
});

export const __worker_mode = 'rent-estimator' as const;
