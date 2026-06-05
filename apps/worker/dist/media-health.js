// Media-health crawler. Continuously monitors primary_photo URLs in the
// listings table and stamps their HTTP status back into media_url_status.
//
// Lifecycle:
// 1. On boot, query for rows needing a recheck:
//    WHERE media_url_status = 0 OR (media_url_status >= 500 AND media_last_checked < now() - 24h)
//    ORDER BY media_last_checked NULLS FIRST LIMIT 200
// 2. For each row's primary_photo: HEAD request with 5s timeout.
// 3. Map response to media_url_status:
//    - 200–299 → 200
//    - 4xx → exact code
//    - 5xx or network error → exact code (599 for connect-fail)
// 4. UPDATE listings SET media_url_status=$status, media_last_checked=now() WHERE id=$id
// 5. Polite concurrency: env MEDIA_HEALTH_CONCURRENCY (default 8), 50ms delay between launches.
// 6. Idle: sleep MEDIA_HEALTH_INTERVAL_MS (default 5m) when nothing pending, then loop.
import { Pool } from 'pg';
import { loadEnv } from './env.js';
import { getLogger, newTraceId, withTrace } from './logger.js';
const env = loadEnv();
const log = getLogger(env.LOG_LEVEL);
// ---------------------------------------------------------------------------
// Pool
// ---------------------------------------------------------------------------
const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: Math.max(env.MEDIA_HEALTH_CONCURRENCY + 2, 4),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
});
pool.on('error', (err) => {
    log.warn({ err: err.message }, 'pool idle client error');
});
// ---------------------------------------------------------------------------
// Bounded concurrency (same semaphore pattern as rent-estimator)
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
const semaphore = new Semaphore(env.MEDIA_HEALTH_CONCURRENCY);
let inFlight = 0;
// ---------------------------------------------------------------------------
// Check URL health
// ---------------------------------------------------------------------------
async function checkMediaHealth(url) {
    try {
        const response = await fetch(url, {
            method: 'HEAD',
            signal: AbortSignal.timeout(5000),
            redirect: 'follow',
        });
        const status = response.status;
        // 200–299 → normalize to 200
        if (status >= 200 && status < 300) {
            return 200;
        }
        // 4xx → exact code
        if (status >= 400 && status < 500) {
            return status;
        }
        // 5xx → exact code
        if (status >= 500) {
            return status;
        }
        // Unexpected (1xx, 3xx) → treat as success
        return 200;
    }
    catch (err) {
        // Network error, timeout → 599
        if (err instanceof Error && err.name === 'AbortError') {
            return 599;
        }
        // Other network errors
        return 599;
    }
}
// ---------------------------------------------------------------------------
// Process a single listing
// ---------------------------------------------------------------------------
async function processListing(row, traceLog) {
    if (!row.primary_photo) {
        traceLog.debug({ listing_id: row.id }, 'no primary_photo, skipping');
        return;
    }
    const status = await checkMediaHealth(row.primary_photo);
    try {
        await pool.query(`UPDATE listings SET media_url_status = $1, media_last_checked = now()
       WHERE id = $2`, [status, row.id]);
        traceLog.info({ listing_id: row.id, status, url: row.primary_photo }, 'media health checked');
    }
    catch (err) {
        traceLog.error({ listing_id: row.id, err: String(err) }, 'failed to update media status');
    }
}
// ---------------------------------------------------------------------------
// Fetch batch of rows needing recheck
// ---------------------------------------------------------------------------
async function fetchBatch() {
    try {
        const result = await pool.query(`SELECT id, primary_photo FROM listings
       WHERE media_url_status = 0
          OR (media_url_status >= 500 AND media_last_checked < now() - interval '24 hours')
       ORDER BY media_last_checked NULLS FIRST
       LIMIT 200`);
        return result.rows;
    }
    catch (err) {
        log.error({ err: String(err) }, 'failed to fetch media health batch');
        return [];
    }
}
// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
async function processLoop() {
    const traceId = newTraceId();
    const traceLog = withTrace(log, traceId, { worker: 'media-health' });
    while (!shutdownRequested) {
        const batch = await fetchBatch();
        if (batch.length === 0) {
            traceLog.debug({ interval_ms: env.MEDIA_HEALTH_INTERVAL_MS }, 'no listings to check, sleeping');
            await new Promise((resolve) => setTimeout(resolve, env.MEDIA_HEALTH_INTERVAL_MS));
            continue;
        }
        traceLog.info({ batch_size: batch.length }, 'processing batch');
        const launches = [];
        for (const row of batch) {
            if (shutdownRequested) {
                break;
            }
            // Polite delay between launches
            await new Promise((resolve) => setTimeout(resolve, 50));
            await semaphore.acquire();
            inFlight += 1;
            const jobPromise = processListing(row, traceLog)
                .then(() => {
                inFlight -= 1;
                semaphore.release();
            })
                .catch((err) => {
                inFlight -= 1;
                semaphore.release();
                traceLog.error({ err: String(err), row_id: row.id }, 'unhandled job error');
            });
            launches.push(jobPromise);
        }
        // Wait for all in-flight jobs to complete
        await Promise.all(launches);
    }
    traceLog.info('media health loop ended');
}
// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
let shutdownRequested = false;
async function gracefulShutdown(signal) {
    log.info({ signal }, 'shutdown requested');
    shutdownRequested = true;
    // Wait for in-flight jobs to finish
    let waited = 0;
    while (inFlight > 0 && waited < 60_000) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        waited += 100;
    }
    if (inFlight > 0) {
        log.warn({ in_flight: inFlight }, 'timeout waiting for in-flight jobs, force exiting');
    }
    await pool.end();
    log.info('pool closed');
    process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
(async () => {
    try {
        log.info({
            concurrency: env.MEDIA_HEALTH_CONCURRENCY,
            interval_ms: env.MEDIA_HEALTH_INTERVAL_MS,
        }, 'media-health worker starting');
        // Verify database connectivity
        const testResult = await pool.query('SELECT 1');
        if (testResult.rows.length === 0) {
            throw new Error('database connectivity test failed');
        }
        log.info('database connected');
        await processLoop();
    }
    catch (err) {
        log.error({ err: String(err) }, 'startup failed');
        process.exit(1);
    }
})();
//# sourceMappingURL=media-health.js.map