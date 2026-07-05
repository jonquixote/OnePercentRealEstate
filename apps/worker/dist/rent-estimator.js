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
import { Client, Pool } from 'pg';
import { loadEnv } from './env.js';
import { getLogger, newTraceId, withTrace } from './logger.js';
import { Redis } from 'ioredis';
const env = loadEnv();
const log = getLogger(env.LOG_LEVEL);
// ---------------------------------------------------------------------------
// Redis for cache busting after rent calculations
// ---------------------------------------------------------------------------
let redisClient = null;
function getRedis() {
    if (!env.REDIS_URL)
        return null;
    if (!redisClient) {
        redisClient = new Redis(env.REDIS_URL, {
            maxRetriesPerRequest: null,
            retryStrategy(times) {
                return Math.min(times * 200, 5000);
            },
            lazyConnect: true,
        });
        redisClient.on('error', (err) => {
            log.warn({ err: err.message }, 'redis connection error');
        });
    }
    return redisClient;
}
// Counter to batch cache-busting (every N completions)
let completionsSinceLastBust = 0;
const BUST_EVERY = 25;
async function bustFrontendCaches() {
    const r = getRedis();
    if (!r)
        return;
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
    }
    catch (err) {
        log.warn({ err: err.message }, 'failed to bust frontend caches');
    }
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
    available;
    waiters = [];
    constructor(max) {
        this.available = max;
    }
    async acquire() {
        if (this.available > 0) {
            this.available -= 1;
            return;
        }
        await new Promise((resolve) => this.waiters.push(resolve));
    }
    release() {
        const next = this.waiters.shift();
        if (next) {
            next();
        }
        else {
            this.available += 1;
        }
    }
}
const semaphore = new Semaphore(env.RENT_WORKER_CONCURRENCY);
let inFlight = 0;
let shuttingDown = false;
// ---------------------------------------------------------------------------
// processJob: load row → call ML → write back. Each step has its own
// failure handling so we never leave a row pinned in 'pending' silently.
// ---------------------------------------------------------------------------
async function loadListing(listingId, parentLog) {
    // SELECT pulls only what the ML shim needs. zip_code lives in raw_data
    // for legacy rows; the dedicated `zip_code` column is populated by the
    // newer scraper writes.
    const res = await pool.query(`SELECT id,
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
            public.is_rentable(property_type) AS is_rentable
       FROM listings
      WHERE id = $1`, [listingId]);
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
    };
}
async function callMlService(payload, parentLog) {
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
        const json = (await res.json());
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
    }
    catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
            parentLog.warn({ timeout_ms: env.RENT_TIMEOUT_MS }, 'ml request timed out');
            throw new Error(`ml timeout after ${env.RENT_TIMEOUT_MS}ms`);
        }
        throw err;
    }
    finally {
        clearTimeout(timer);
    }
}
async function markDone(listingId, predictedRent, modelVersion, features) {
    // Single transaction: update listings + append audit row. If either
    // half fails we want to roll back so the row stays 'pending' for retry
    // rather than getting orphaned in audit without a stamped estimate.
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`UPDATE listings
          SET estimated_rent = $2,
              rent_calc_status = 'done',
              rent_model_version = $3,
              updated_at = NOW()
        WHERE id = $1`, [listingId, predictedRent, modelVersion]);
        await client.query(`INSERT INTO rent_predictions_audit (listing_id, model_version, predicted_rent, features)
       VALUES ($1, $2, $3, $4::jsonb)`, [listingId, modelVersion, predictedRent, JSON.stringify(features)]);
        await client.query('COMMIT');
    }
    catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        throw err;
    }
    finally {
        client.release();
    }
}
async function markFailed(listingId, reason) {
    await pool.query(`UPDATE listings
        SET rent_calc_status = 'failed',
            updated_at = NOW()
      WHERE id = $1`, [listingId]);
    log.error({ listing_id: listingId, reason: reason.slice(0, 500) }, 'rent calc failed');
}
async function processListing(listingId, parentLog) {
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
    try {
        const prediction = await callMlService(payload, jobLog);
        await markDone(payload.listing_id, prediction.predicted_rent, prediction.model_version, payload);
        jobLog.info({
            duration_ms: Date.now() - start,
            predicted_rent: prediction.predicted_rent,
            model_version: prediction.model_version,
        }, 'rent calc done');
        // Bust frontend caches periodically
        completionsSinceLastBust++;
        if (completionsSinceLastBust >= BUST_EVERY) {
            completionsSinceLastBust = 0;
            await bustFrontendCaches();
        }
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        try {
            await markFailed(payload.listing_id, message);
        }
        catch (markErr) {
            jobLog.error({ markErr: markErr.message }, 'failed to mark rent_calc_status=failed (will be retried on next NOTIFY/update)');
        }
        jobLog.error({ err: message, duration_ms: Date.now() - start }, 'rent calc errored');
    }
}
// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------
function runJob(listingId, parentLog) {
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
        }
        finally {
            semaphore.release();
            inFlight -= 1;
        }
    })
        .catch((err) => {
        parentLog.error({ err: err.message, listing_id: listingId }, 'unexpected runJob error');
        semaphore.release();
        inFlight -= 1;
    });
}
// ---------------------------------------------------------------------------
// Drain: pull a bounded batch of pending rows. Uses the partial index
// from 2026_06_03_rent_calc_async.sql so the scan is cheap even with
// hundreds of thousands of 'done' rows in the table.
// ---------------------------------------------------------------------------
async function drain(parentLog) {
    const res = await pool.query(`SELECT id::text AS id
       FROM listings
      WHERE rent_calc_status = 'pending'
      ORDER BY id
      LIMIT $1`, [env.RENT_BACKFILL_BATCH]);
    if (res.rowCount === 0) {
        parentLog.debug('drain: no pending listings');
        return 0;
    }
    parentLog.info({ count: res.rowCount }, 'drain: dispatching pending listings');
    for (const row of res.rows) {
        runJob(row.id, parentLog);
    }
    return res.rowCount ?? 0;
}
// ---------------------------------------------------------------------------
// LISTEN client with reconnect loop. Identical shape to crawl.ts.
// ---------------------------------------------------------------------------
const CHANNEL = 'rent_job_enqueued';
async function listenLoop(parentLog) {
    let backoff = 1_000;
    const MAX_BACKOFF = 60_000;
    while (!shuttingDown) {
        const client = new Client({ connectionString: env.DATABASE_URL });
        let connected = false;
        try {
            await client.connect();
            connected = true;
            backoff = 1_000;
            client.on('notification', (msg) => {
                if (msg.channel !== CHANNEL || !msg.payload)
                    return;
                if (shuttingDown)
                    return;
                runJob(msg.payload, parentLog);
            });
            client.on('error', (err) => {
                parentLog.warn({ err: err.message }, 'LISTEN client error');
                void client.end().catch(() => { });
            });
            await client.query(`LISTEN ${CHANNEL}`);
            parentLog.info({ channel: CHANNEL }, 'subscribed to channel');
            // Subscribe-then-drain order matters: any NOTIFY arriving between
            // these two awaits will still be delivered once drain returns.
            await drain(parentLog);
            // Block until the connection ends, then loop to reconnect.
            await new Promise((resolve) => {
                client.once('end', () => resolve());
                client.once('error', () => resolve());
            });
            parentLog.warn('LISTEN connection ended, will reconnect');
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            parentLog.error({ err: msg, backoff_ms: backoff }, 'LISTEN loop error');
        }
        finally {
            if (connected) {
                await client.end().catch(() => { });
            }
        }
        if (shuttingDown)
            break;
        await sleep(backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF);
    }
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------
async function shutdown(signal) {
    if (shuttingDown)
        return;
    shuttingDown = true;
    log.info({ signal, in_flight: inFlight }, 'shutdown initiated');
    const deadline = Date.now() + 30_000;
    while (inFlight > 0 && Date.now() < deadline) {
        await sleep(250);
    }
    if (inFlight > 0) {
        log.warn({ in_flight: inFlight }, 'in-flight rent jobs did not drain within 30s; exiting anyway');
    }
    await pool.end().catch(() => { });
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
async function main() {
    log.info({
        concurrency: env.RENT_WORKER_CONCURRENCY,
        ml: env.ML_URL,
        backfill_batch: env.RENT_BACKFILL_BATCH,
    }, 'rent-estimator worker starting');
    // First-touch drain runs against the same pending queue the LISTEN
    // loop will keep draining; harmless if it overlaps slightly with the
    // post-subscribe drain.
    await drain(log).catch((err) => log.error({ err: err.message }, 'initial drain failed'));
    await listenLoop(log);
}
void main().catch((err) => {
    log.error({ err: err.message }, 'fatal: rent-estimator exiting');
    process.exit(1);
});
export const __worker_mode = 'rent-estimator';
//# sourceMappingURL=rent-estimator.js.map