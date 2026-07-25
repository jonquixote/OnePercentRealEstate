import { NextResponse } from 'next/server';
import { cachedSWR } from '@/lib/cache-swr';
import { computeAndStoreStats, readStatsSummary } from '@/lib/stats-compute';
import { withSpan } from '@/lib/tracing';

export const dynamic = 'force-dynamic';

/**
 * Median estimated rent for the hero.
 *
 * Was its own `percentile_cont` over every listing — **7.1s cold** on prod.
 * That number is now computed in the same single pass as the rest of the hero
 * stats and stored on the `stats_summary` row, so this endpoint is a
 * primary-key lookup behind stale-while-revalidate.
 */
const FRESH_S = 300;
const STALE_S = 86_400;

export async function GET() {
  return withSpan('api.stats.median-rent', () => handleGet());
}

async function handleGet() {
  try {
    const medianRent = await cachedSWR<number | null>(
      'home:median-rent:v2',
      FRESH_S,
      STALE_S,
      async () => {
        const stored = await readStatsSummary('buy_hold');
        if (stored) return stored.payload.medianRent ?? null;
        const computed = await computeAndStoreStats('buy_hold');
        return computed.medianRent ?? null;
      },
    );

    return NextResponse.json(
      { medianRent },
      { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400' } },
    );
  } catch (error) {
    console.error('Stats median-rent error:', error);
    return NextResponse.json({ medianRent: null }, { status: 500 });
  }
}
