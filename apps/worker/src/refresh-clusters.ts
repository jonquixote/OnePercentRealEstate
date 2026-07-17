// Refreshes mv_cluster_tiles every CLUSTER_REFRESH_INTERVAL_MS.
// Uses REFRESH MATERIALIZED VIEW CONCURRENTLY so reads keep working
// during refresh — the unique index added in
// 2026_06_03_mv_cluster_tiles.sql is what makes that legal.
//
// Runs in its own process / container so a crawl-worker crash doesn't
// pause MV refreshes and vice-versa. Same image, different CMD.

import { Pool } from 'pg';
import { loadEnv } from './env.js';
import { getLogger, newTraceId, withTrace } from './logger.js';

const env = loadEnv();
const log = getLogger(env.LOG_LEVEL);

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 2,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  log.warn({ err: err.message }, 'pool idle client error');
});

let shuttingDown = false;
let inFlight = false;

// Wave 8: threshold refresh. A full CONCURRENTLY refresh costs ~85s at
// ~950K listings (14% duty at the 10-min cadence) and most ticks change
// nothing the tiles can see. Tiles depend on inserts + price/status
// changes, NOT on rent-worker updated_at churn — so the high-water mark is
// max(created_at) (new rows) + max(listings_history.id) (the trigger
// writes history exactly when price/status/DOM change). Both are
// index-cheap lookups.
let lastHighWater: string | null = null;

async function tilesInputChanged(log2: ReturnType<typeof withTrace>): Promise<boolean> {
  try {
    const res = await pool.query<{ hw: string }>(
      `SELECT coalesce(max(created_at)::text, '') || '|' ||
              coalesce((SELECT max(observed_at)::text FROM listings_history), '') AS hw
         FROM listings`,
    );
    const hw = res.rows[0]?.hw ?? '';
    if (hw !== lastHighWater) {
      lastHighWater = hw;
      return true;
    }
    return false;
  } catch (err) {
    // The check failing must never block the refresh itself.
    log2.warn({ err: (err as Error).message }, 'high-water check failed; refreshing anyway');
    return true;
  }
}

async function refreshOnce(): Promise<void> {
  if (inFlight) {
    log.warn('previous refresh still running; skipping this tick');
    return;
  }
  inFlight = true;
  const traceId = newTraceId();
  const log2 = withTrace(log, traceId);
  const start = Date.now();
  try {
    if (!(await tilesInputChanged(log2))) {
      log2.info('tiles input unchanged since last refresh; skipping');
      return;
    }
    // CONCURRENTLY requires that the MV has a UNIQUE index — that's the
    // uq_mv_cluster_tiles_zoom_xy from the migration. If a future
    // schema change drops that index this call will fail hard and the
    // logs make the cause obvious.
    await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_cluster_tiles');
    log2.info({ duration_ms: Date.now() - start }, 'cluster MV refreshed');
  } catch (err) {
    log2.error(
      { err: (err as Error).message, duration_ms: Date.now() - start },
      'cluster MV refresh failed',
    );
  } finally {
    inFlight = false;
  }
}

// Wave: homepage markets grid. Unlike the cluster tiles (which only change on
// listing inserts/price edits), market medians move on their own cadence, so
// this refreshes on its OWN timer (~30 min) — it does NOT reuse the tiles
// high-water gate. CONCURRENTLY needs the unique index from
// 2026_07_17_mv_market_grid.sql; before that migration runs the refresh warns
// and is a no-op.
const MARKET_REFRESH_INTERVAL_MS = 30 * 60 * 1000;

async function refreshMarketsOnce(log2: ReturnType<typeof withTrace>): Promise<void> {
  const start = Date.now();
  try {
    await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_market_grid');
    log2.info({ duration_ms: Date.now() - start }, 'market grid MV refreshed');
  } catch (err) {
    // 42P01 = view doesn't exist yet (migration not applied). Warn only.
    const code = (err as { code?: string })?.code;
    if (code === '42P01') {
      log2.warn('mv_market_grid not found (migration pending); skipping');
    } else {
      log2.error(
        { err: (err as Error).message, duration_ms: Date.now() - start },
        'market grid MV refresh failed',
      );
    }
  }
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal, in_flight: inFlight }, 'refresh shutdown initiated');
  const deadline = Date.now() + 30_000;
  while (inFlight && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
  }
  await pool.end().catch(() => {});
  log.info('refresh shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

async function main(): Promise<void> {
  log.info({ interval_ms: env.CLUSTER_REFRESH_INTERVAL_MS }, 'refresh worker starting');

  // Kick the first refresh ~30s after boot rather than immediately, so
  // a deploy doesn't slam the DB during the rollout window. Subsequent
  // refreshes follow the configured interval.
  await new Promise((r) => setTimeout(r, 30_000));
  if (shuttingDown) return;
  await refreshOnce();

  // setInterval ref()s by default, which is what we want — the worker
  // is a long-running daemon and the timer is the heartbeat.
  setInterval(() => {
    if (shuttingDown) return;
    void refreshOnce();
  }, env.CLUSTER_REFRESH_INTERVAL_MS);

  // Markets grid: own ~30-min timer, independent of the tiles high-water gate.
  await new Promise((r) => setTimeout(r, 60_000));
  if (shuttingDown) return;
  await refreshMarketsOnce(withTrace(log, newTraceId()));
  setInterval(() => {
    if (shuttingDown) return;
    void refreshMarketsOnce(withTrace(log, newTraceId()));
  }, MARKET_REFRESH_INTERVAL_MS);
}

void main().catch((err) => {
  log.error({ err: (err as Error).message }, 'fatal: refresh worker exiting');
  process.exit(1);
});
