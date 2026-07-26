/**
 * Bounded per-route latency tracking.
 *
 * WHY: every performance problem found in the last week was found BY HAND after
 * a human noticed — the hero at 18.5s, market pages at 10.4s each, a monitoring
 * query at 79% of all DB time, a health probe at 8.4s. The evidence existed
 * (the app even logs `[SLOW QUERY]`), but nothing aggregated it, so "someone
 * complains" was the detection mechanism.
 *
 * CRITICAL CONSTRAINT: observability must not become the load problem it
 * detects. That is not hypothetical here — the postgres-exporter's metrics
 * collection consumed 79% of the database, and a freshness probe cost 8.4s a
 * run. So this module is deliberately:
 *   - in-memory only (no write per request — an aggregate is flushed on a timer)
 *   - a FIXED-SIZE ring per route (memory cannot grow with traffic)
 *   - capped in distinct routes (a route explosion folds into "other")
 *   - non-throwing: instrumentation must never break a request
 */

const MAX_SAMPLES_PER_ROUTE = 500;
const MAX_ROUTES = 64;
const OTHER = 'other';

interface Ring {
  samples: Float64Array;
  next: number;
  count: number; // total observed (may exceed samples.length)
}

const rings = new Map<string, Ring>();

function ringFor(route: string): Ring {
  let r = rings.get(route);
  if (r) return r;
  // Reserve one slot for OTHER so folding can never push us past the cap.
  if (rings.size >= MAX_ROUTES - 1) {
    // Fold unknown/unbounded route shapes together rather than growing forever.
    route = OTHER;
    r = rings.get(route);
    if (r) return r;
  }
  r = { samples: new Float64Array(MAX_SAMPLES_PER_ROUTE), next: 0, count: 0 };
  rings.set(route, r);
  return r;
}

/** Record one request's duration. O(1), allocation-free, never throws. */
export function trackRoute(route: string, ms: number): void {
  try {
    if (!Number.isFinite(ms) || ms < 0) return;
    const r = ringFor(route);
    r.samples[r.next] = ms;
    r.next = (r.next + 1) % MAX_SAMPLES_PER_ROUTE;
    r.count++;
  } catch {
    /* instrumentation must never break a request */
  }
}

export interface RouteStats {
  route: string;
  count: number;      // samples currently held
  observed: number;   // total ever observed
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

/** Percentiles from a copy of the live samples (nearest-rank). */
export function percentiles(values: number[]): { p50: number; p95: number; p99: number; max: number } {
  if (values.length === 0) return { p50: 0, p95: 0, p99: 0, max: 0 };
  const s = [...values].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: s[s.length - 1] };
}

/** Snapshot every tracked route. Read-only; safe to call from a handler. */
export function snapshot(): RouteStats[] {
  const out: RouteStats[] = [];
  for (const [route, r] of rings) {
    const held = Math.min(r.count, MAX_SAMPLES_PER_ROUTE);
    if (held === 0) continue;
    const vals: number[] = [];
    for (let i = 0; i < held; i++) vals.push(r.samples[i]);
    const p = percentiles(vals);
    out.push({ route, count: held, observed: r.count, ...p });
  }
  return out.sort((a, b) => b.p95 - a.p95);
}

/** Test-only. */
export function __resetPerfTracking(): void {
  rings.clear();
}
