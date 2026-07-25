import { NextResponse } from 'next/server';
import { STRATEGY_WHITELIST, computeAndStoreStats } from '@/lib/stats-compute';

export const dynamic = 'force-dynamic';
// The aggregate scans ~1.3M rows per strategy; give it room.
export const maxDuration = 300;

/**
 * Refresh the precomputed hero stats. Driven by `oper-stats-refresh.timer`,
 * NOT by user traffic — that is the entire point: the 18.5s aggregate runs
 * here on a schedule so `/api/stats` only ever does a primary-key lookup.
 *
 * Admin-gated (ADMIN_API_KEY), same convention as /api/admin/*.
 */
export async function POST(req: Request) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) {
    return NextResponse.json({ error: 'refresh disabled: ADMIN_API_KEY not configured' }, { status: 501 });
  }
  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: Record<string, { ms: number; total?: number; error?: string }> = {};
  for (const strategy of STRATEGY_WHITELIST) {
    const started = Date.now();
    try {
      const payload = await computeAndStoreStats(strategy);
      results[strategy] = { ms: Date.now() - started, total: payload.total };
    } catch (err) {
      results[strategy] = { ms: Date.now() - started, error: (err as Error).message };
    }
  }
  const failed = Object.values(results).some((r) => r.error);
  return NextResponse.json({ ok: !failed, results }, { status: failed ? 500 : 200 });
}
