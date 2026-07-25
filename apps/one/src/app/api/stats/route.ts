import { NextResponse } from 'next/server';
import { cachedSWR } from '@/lib/cache-swr';
import { withSpan } from '@/lib/tracing';
import {
  STRATEGY_WHITELIST,
  computeAndStoreStats,
  readStatsSummary,
  type StatsPayload,
} from '@/lib/stats-compute';

export const dynamic = 'force-dynamic';

/**
 * Homepage hero numbers.
 *
 * This route used to run the aggregate inline: a seq scan over ~1.3M listings
 * measuring **18.5s cold** on prod, behind a 120s TTL with no request
 * coalescing — so a real user paid full price every couple of minutes and
 * everyone arriving during that window queued behind them ("the hero takes a
 * minute"). The expensive query now runs OUT of the request path and lands in
 * `stats_summary`; this handler does a primary-key lookup, wrapped in
 * stale-while-revalidate + single-flight so a cold cache is never user-visible.
 *
 * The SQL itself lives in @/lib/stats-compute (moved verbatim — this is a
 * latency change, not a semantics change; see contract.test.ts).
 *
 * Falls back to an inline compute ONLY when the table has never been populated
 * (fresh database / first deploy), and stores the result so it happens once.
 */

// Serve from Redis for 5 min; keep serving stale for up to 24h while a refresh
// happens behind the request. The stored row has its own refresh cadence, so
// "stale" here means seconds-to-minutes of drift, never wrong data.
const FRESH_S = 300;
const STALE_S = 86_400;

export async function GET(req: Request) {
  return withSpan('api.stats', () => handleGet(req));
}

async function handleGet(req: Request) {
  const url = new URL(req.url);
  const strategyParam = url.searchParams.get('strategy') || 'buy_hold';
  const strategy = STRATEGY_WHITELIST.has(strategyParam) ? strategyParam : 'buy_hold';

  try {
    const payload = await withSpan('home.stats', () =>
      cachedSWR<StatsPayload & { medianRent: number | null }>(
        `home:stats:v3:${strategy}`,
        FRESH_S,
        STALE_S,
        async () => {
          const stored = await readStatsSummary(strategy);
          if (stored) return stored.payload;
          // Never populated (fresh DB / first deploy): compute once and persist
          // so the next reader is fast instead of repeating an 18s query.
          return computeAndStoreStats(strategy);
        },
      ),
    );

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400',
      },
    });
  } catch (err) {
    console.error('/api/stats error:', err);
    return NextResponse.json({ error: 'stats unavailable' }, { status: 500 });
  }
}
