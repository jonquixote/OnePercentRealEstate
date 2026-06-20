// Tiny env loader for the worker. Strict at startup — fail fast if the
// runtime can't talk to Postgres or the scraper. We do NOT read .env
// files here on purpose: in docker-compose env is injected via env_file;
// in dev, the parent shell handles it. Keeps the worker dependency-free
// of dotenv and avoids subtle "which .env wins" bugs across waves.
//
// Wave 3 may extend this file with rent-estimator-specific entries
// (ML_URL, RENT_TIMEOUT_MS, RENT_BACKFILL_BATCH). Keep that pattern.

export interface WorkerEnv {
  readonly DATABASE_URL: string;
  readonly SCRAPER_URL: string;
  readonly WORKER_CONCURRENCY: number;
  readonly CLUSTER_REFRESH_INTERVAL_MS: number;
  readonly LOG_LEVEL: string;
  readonly SCRAPE_TIMEOUT_MS: number;
  // Wave 3 — rent estimator service
  readonly ML_URL: string;
  readonly RENT_TIMEOUT_MS: number;
  readonly RENT_BACKFILL_BATCH: number;
  readonly RENT_WORKER_CONCURRENCY: number;
  // Redis for cache busting after rent calculations
  readonly REDIS_URL: string;
  // Wave 7 — media health crawler
  readonly MEDIA_HEALTH_CONCURRENCY: number;
  readonly MEDIA_HEALTH_INTERVAL_MS: number;
  // Wave 7 — ML scheduler
  readonly OPS_WEBHOOK_URL: string | null;
  // Wave 6 — watchlist alerts
  readonly RESEND_API_KEY: string;
  readonly WATCHLIST_TICK_MS: number;
  readonly WATCHLIST_FROM_EMAIL: string;
}

function readString(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v && v.length > 0) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required env var: ${name}`);
}

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid integer for ${name}: ${raw}`);
  }
  return n;
}

function readStringOpt(name: string): string | null {
  const v = process.env[name];
  if (v && v.length > 0) return v;
  return null;
}

export function loadEnv(): WorkerEnv {
  return {
    DATABASE_URL: readString('DATABASE_URL'),
    SCRAPER_URL: readString('SCRAPER_URL', 'http://scraper:8000'),
    WORKER_CONCURRENCY: readInt('WORKER_CONCURRENCY', 2),
    // Cluster MV refresh cadence. 10 min default matches the Wave 2 plan.
    CLUSTER_REFRESH_INTERVAL_MS: readInt('CLUSTER_REFRESH_INTERVAL_MS', 10 * 60 * 1000),
    LOG_LEVEL: readString('LOG_LEVEL', 'info'),
    // Scrape requests can be slow on large regions. 10 min ceiling so a
    // hung scrape doesn't pin a worker slot forever — the
    // recycle_stuck_jobs() safety net catches anything stuck longer
    // than 5 min anyway.
    SCRAPE_TIMEOUT_MS: readInt('SCRAPE_TIMEOUT_MS', 10 * 60 * 1000),
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
  };
}
