import { NextResponse } from 'next/server';
import { snapshot } from '@oper/observability/perf-track';

export const dynamic = 'force-dynamic';

/**
 * Per-route latency for the terminal, admin-gated.
 *
 * The terminal responded in ~7ms and nobody was watching — which is exactly the
 * state apps/one was in while its hero aggregate sat at 18.5s. Reads the
 * in-memory ring, so checking latency costs no query and can never become the
 * load problem it exists to detect.
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
    app: 'two',
    generatedAt: new Date().toISOString(),
    routes,
    slowest: routes.slice(0, 5).map((r) => ({ route: r.route, p95: Math.round(r.p95) })),
  });
}
