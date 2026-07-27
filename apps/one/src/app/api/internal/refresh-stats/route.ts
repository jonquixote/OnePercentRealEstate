import { NextResponse } from 'next/server';
import { STRATEGY_WHITELIST, computeAllStats, storeStats } from '@/lib/stats-compute';
import { getMarketRanking } from '@/lib/market-ranking';

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
  // ONE scan for all four strategies. The scan is ~585k rows and is identical
  // per strategy — only the resolve_rule() lookup varied — so this was four
  // full scans costing ~73s a cycle and tripping db-load-budget at 46.9% of a
  // window. Measured: 73s -> 27.3s, with output verified identical for every
  // strategy against the old per-strategy query on the same snapshot.
  const started = Date.now();
  try {
    const all = await computeAllStats();
    for (const [strategy, payload] of all) {
      await storeStats(payload);
      results[strategy] = { ms: Date.now() - started, total: payload.total };
    }
  } catch (err) {
    for (const strategy of STRATEGY_WHITELIST) {
      results[strategy] = { ms: Date.now() - started, error: (err as Error).message };
    }
  }

  // Warm the nationwide ZIP ranking too. It is shared by all 21,466 market
  // pages and costs ~10s cold — warming it here means the unlucky first
  // visitor (often a crawler) never pays for it.
  const rankStarted = Date.now();
  try {
    const ranking = await getMarketRanking();
    results['market_ranking'] = { ms: Date.now() - rankStarted, total: ranking.length };
  } catch (err) {
    results['market_ranking'] = { ms: Date.now() - rankStarted, error: (err as Error).message };
  }

  const failed = Object.values(results).some((r) => r.error);
  return NextResponse.json({ ok: !failed, results }, { status: failed ? 500 : 200 });
}
