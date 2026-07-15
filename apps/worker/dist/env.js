// Tiny env loader for the worker. Strict at startup — fail fast if the
// runtime can't talk to Postgres or the scraper. We do NOT read .env
// files here on purpose: in docker-compose env is injected via env_file;
// in dev, the parent shell handles it. Keeps the worker dependency-free
// of dotenv and avoids subtle "which .env wins" bugs across waves.
//
// Wave 3 may extend this file with rent-estimator-specific entries
// (ML_URL, RENT_TIMEOUT_MS, RENT_BACKFILL_BATCH). Keep that pattern.
function readString(name, fallback) {
    const v = process.env[name];
    if (v && v.length > 0)
        return v;
    if (fallback !== undefined)
        return fallback;
    throw new Error(`Missing required env var: ${name}`);
}
function readInt(name, fallback) {
    const raw = process.env[name];
    if (!raw)
        return fallback;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`Invalid integer for ${name}: ${raw}`);
    }
    return n;
}
// Like readInt but allows 0 — for pacing/jitter knobs where 0 legitimately
// means "disable" (e.g. no inter-pass jitter). Still rejects negatives.
function readIntMin0(name, fallback) {
    const raw = process.env[name];
    if (!raw)
        return fallback;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0) {
        throw new Error(`Invalid integer for ${name}: ${raw}`);
    }
    return n;
}
function readStringOpt(name) {
    const v = process.env[name];
    if (v && v.length > 0)
        return v;
    return null;
}
export function loadEnv() {
    return {
        DATABASE_URL: readString('DATABASE_URL'),
        SCRAPER_URL: readString('SCRAPER_URL', 'http://scraper:8000'),
        // Default 1 (serialized) to match the old n8n workflow's gentle, one-ZIP-
        // at-a-time cadence that avoided Realtor.com IP blocks for months.
        WORKER_CONCURRENCY: readInt('WORKER_CONCURRENCY', 1),
        // Cluster MV refresh cadence. 10 min default matches the Wave 2 plan.
        CLUSTER_REFRESH_INTERVAL_MS: readInt('CLUSTER_REFRESH_INTERVAL_MS', 10 * 60 * 1000),
        LOG_LEVEL: readString('LOG_LEVEL', 'info'),
        // Scrape requests can be slow on large regions. 10 min ceiling so a
        // hung scrape doesn't pin a worker slot forever — the in-worker
        // reaperLoop() re-pends anything stuck in 'processing' past ~1.5× the
        // worst-case job budget. (Prod sets SCRAPE_TIMEOUT_MS=240000.)
        SCRAPE_TIMEOUT_MS: readInt('SCRAPE_TIMEOUT_MS', 10 * 60 * 1000),
        // Anti-block pacing. Minimum wall-clock gap between job STARTS across all
        // runners (~30s ≈ old n8n schedule tick); randomized gap between the passes
        // of one ZIP; and the initial cool-off when Realtor.com blocks our IP
        // (doubles per consecutive block up to a 4h cap, in crawl.ts). Interval and
        // jitter accept 0 to disable.
        CRAWL_JOB_MIN_INTERVAL_MS: readIntMin0('CRAWL_JOB_MIN_INTERVAL_MS', 30 * 1000),
        CRAWL_PASS_JITTER_MS: readIntMin0('CRAWL_PASS_JITTER_MS', 1_500),
        CRAWL_BLOCK_COOLOFF_MS: readInt('CRAWL_BLOCK_COOLOFF_MS', 30 * 60 * 1000),
        // Wave 3
        ML_URL: readString('ML_URL', 'http://ml:8000'),
        REDIS_URL: readString('REDIS_URL', ''),
        // 30s ceiling per prediction. The legacy in-DB trigger took 30–80 ms;
        // the FastAPI shim re-wraps the same math + a DB lookup so a 30s budget
        // is two orders of magnitude of headroom for tail latency.
        RENT_TIMEOUT_MS: readInt('RENT_TIMEOUT_MS', 30 * 1000),
        // Bound on the drain-on-boot batch. Set low so the worker isn't holding
        // a giant SELECT FOR UPDATE while the rest of the system warms up.
        RENT_BACKFILL_BATCH: readInt('RENT_BACKFILL_BATCH', 50),
        // Separate from WORKER_CONCURRENCY so crawl and rent can be tuned
        // independently — rent calls a downstream HTTP service while crawl
        // spawns a heavy scrape, so their concurrency profiles differ.
        RENT_WORKER_CONCURRENCY: readInt('RENT_WORKER_CONCURRENCY', 4),
        // Wave 0 — continuous backlog drain. When the pending queue is empty
        // the drain loop sleeps this long before re-checking. Realtime inserts
        // still arrive via LISTEN; this only paces the backlog sweep.
        RENT_DRAIN_INTERVAL_MS: readInt('RENT_DRAIN_INTERVAL_MS', 30 * 1000),
        // Wave 2 — one HTTP call + one bulk UPDATE per batch. ml caps at 1000.
        RENT_BATCH_SIZE: readInt('RENT_BATCH_SIZE', 500),
        // Wave 7 — media health crawler. 8 concurrent URL checks; recheck every 5 min.
        MEDIA_HEALTH_CONCURRENCY: readInt('MEDIA_HEALTH_CONCURRENCY', 8),
        MEDIA_HEALTH_INTERVAL_MS: readInt('MEDIA_HEALTH_INTERVAL_MS', 5 * 60 * 1000),
        // Wave 7 — ML scheduler webhook (optional). If set, alerts from drift/eval
        // are POSTed here. Format: https://hooks.slack.com/... or similar.
        OPS_WEBHOOK_URL: readStringOpt('OPS_WEBHOOK_URL'),
        // Wave 6 — watchlist alerts
        RESEND_API_KEY: readString('RESEND_API_KEY', 'dummy_key_for_dev'),
        WATCHLIST_TICK_MS: readInt('WATCHLIST_TICK_MS', 15 * 60 * 1000), // 15 minutes default
        WATCHLIST_FROM_EMAIL: readString('WATCHLIST_FROM_EMAIL', 'alerts@octavo.press'),
        // Tasks 2.1 & 2.2 — HMAC key for one-click unsubscribe tokens and the
        // public base URL used to build those links. Required in production; a
        // dev-only fallback keeps local runs from crashing (tokens won't verify
        // across processes with a mismatched secret, but that's fine for dev).
        UNSUBSCRIBE_SECRET: readString('UNSUBSCRIBE_SECRET', process.env.NODE_ENV !== 'production' ? 'dev-unsub-secret-change-me' : undefined),
        DIGEST_PUBLIC_URL: readString('DIGEST_PUBLIC_URL', 'https://octavo.press'),
    };
}
//# sourceMappingURL=env.js.map