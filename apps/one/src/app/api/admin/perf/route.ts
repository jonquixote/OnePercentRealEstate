import { NextResponse } from 'next/server';
import { snapshot } from '@/lib/perf-track';
import { flushRouteLatency, readTrailingWindow } from '@/lib/perf-flush';

export const dynamic = 'force-dynamic';

function authorized(req: Request): boolean {
  const expected = process.env.ADMIN_API_KEY;
  return !!expected && (req.headers.get('authorization') ?? '') === `Bearer ${expected}`;
}

function configured(): boolean {
  return !!process.env.ADMIN_API_KEY;
}

/**
 * Per-route latency, admin-gated.
 *
 * Exists so slow paths stop being discovered by archaeology. Every perf fix in
 * the last week (hero 18.5s, market pages 10.4s, an exporter query at 79% of DB
 * time, an 8.4s probe) was found only after a human noticed something felt slow.
 *
 * `live` is the in-memory ring — no query, so checking latency can never itself
 * become a load problem. `window` is the persisted trailing hour, so the view
 * still says something useful immediately after a restart.
 */
export async function GET(req: Request) {
  if (!configured()) {
    return NextResponse.json({ error: 'perf disabled: ADMIN_API_KEY not configured' }, { status: 501 });
  }
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const live = snapshot();
  const windowRows = await readTrailingWindow(60);

  // Budget checks want one number per route; prefer live (current) and fall
  // back to the persisted window for routes with no traffic since restart.
  const merged = new Map(windowRows.map((r) => [r.route, r]));
  for (const r of live) merged.set(r.route, r);
  const routes = [...merged.values()].sort((a, b) => b.p95 - a.p95);

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    routes,
    live,
    window: windowRows,
    slowest: routes.slice(0, 5).map((r) => ({ route: r.route, p95: Math.round(r.p95) })),
  });
}

/** Flush the in-memory aggregate to `route_latency_samples`. Timer-driven. */
export async function POST(req: Request) {
  if (!configured()) {
    return NextResponse.json({ error: 'perf disabled: ADMIN_API_KEY not configured' }, { status: 501 });
  }
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const written = await flushRouteLatency();
  return NextResponse.json({ ok: true, written });
}
