import pool from '@/lib/db';
import { snapshot, type RouteStats } from '@/lib/perf-track';

/**
 * Periodic aggregate flush for per-route latency.
 *
 * THE BOUNDED-WRITE RULE: one row per route per window, never one per request.
 * The in-memory ring absorbs the request volume; only the summary is written.
 * A per-request write would make the observability layer a bigger load source
 * than most of the traffic it measures — which is precisely what happened with
 * the postgres-exporter (79% of all database time) before it was replaced with
 * a counter table.
 *
 * Everything here is best-effort: latency bookkeeping must never take down a
 * request path or a process.
 */

const WINDOW_MINUTES_DEFAULT = 60;

/** Write the current snapshot as one row per route. Returns rows written. */
export async function flushRouteLatency(): Promise<number> {
  const routes = snapshot();
  if (routes.length === 0) return 0;

  const values: string[] = [];
  const params: unknown[] = [];
  routes.forEach((r, i) => {
    const b = i * 6;
    values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`);
    params.push(r.route, r.p50, r.p95, r.p99, r.max, r.count);
  });

  try {
    await pool.query(
      `INSERT INTO route_latency_samples (route, p50_ms, p95_ms, p99_ms, max_ms, count)
       VALUES ${values.join(', ')}`,
      params,
    );
    return routes.length;
  } catch {
    // A missing table or a down database must not break the flush timer.
    return 0;
  }
}

/**
 * Persisted aggregates for the trailing window, so the admin view still shows
 * something useful right after a restart (the in-memory ring starts empty).
 */
export async function readTrailingWindow(minutes = WINDOW_MINUTES_DEFAULT): Promise<RouteStats[]> {
  try {
    const res = await pool.query(
      `SELECT route,
              max(p50_ms) AS p50_ms, max(p95_ms) AS p95_ms, max(p99_ms) AS p99_ms,
              max(max_ms) AS max_ms, sum(count)::int AS count
         FROM route_latency_samples
        WHERE captured_at > now() - ($1 || ' minutes')::interval
        GROUP BY route
        ORDER BY max(p95_ms) DESC`,
      [String(minutes)],
    );
    return (res.rows as Array<Record<string, number | string>>).map((r) => ({
      route: String(r.route),
      count: Number(r.count),
      observed: Number(r.count),
      p50: Number(r.p50_ms),
      p95: Number(r.p95_ms),
      p99: Number(r.p99_ms),
      max: Number(r.max_ms),
    }));
  } catch {
    return [];
  }
}
