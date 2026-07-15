// Pure formatter for per-endpoint scraper pool metrics. Kept dependency-free
// of the logger so it's trivially unit-testable — crawl.ts is the only
// caller that wires it into a periodic log line (see METRICS_INTERVAL_MS).
import type { ScraperPool } from './scraper-pool';

export function formatEndpointMetrics(pool: ScraperPool, nowMs: number): Record<string, unknown>[] {
  return pool.endpoints.map((e) => ({
    url: e.url,
    interval_ms: e.intervalMs,
    ok: e.stats.ok,
    blocked: e.stats.blocked,
    error: e.stats.error,
    ready_in_ms: Math.max(0, e.readyAt() - nowMs),
  }));
}
