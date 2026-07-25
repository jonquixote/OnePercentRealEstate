import { NextResponse } from 'next/server';
import { snapshot } from '@/lib/perf-track';

export const dynamic = 'force-dynamic';

/**
 * Per-route latency, admin-gated.
 *
 * Exists so slow paths stop being discovered by archaeology. Every perf fix in
 * the last week (hero 18.5s, market pages 10.4s, an exporter query at 79% of DB
 * time, an 8.4s probe) was found only after a human noticed something felt slow.
 *
 * Reads from the in-memory ring — no query, no table scan, so checking latency
 * can never itself become a load problem.
 */
export async function GET(req: Request) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) {
    return NextResponse.json({ error: 'perf disabled: ADMIN_API_KEY not configured' }, { status: 501 });
  }
  if ((req.headers.get('authorization') ?? '') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const routes = snapshot();
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    routes,
    slowest: routes.slice(0, 5).map((r) => ({ route: r.route, p95: Math.round(r.p95) })),
  });
}
