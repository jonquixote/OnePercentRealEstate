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
  };
}
