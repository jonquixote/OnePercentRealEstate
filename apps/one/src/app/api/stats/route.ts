import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import redis from '@/lib/redis';
import { withSpan } from '@/lib/tracing';

export const dynamic = 'force-dynamic';

const CACHE_KEY = 'home:stats:v2';
const CACHE_TTL_S = 120;
const STRATEGY_WHITELIST = new Set(['buy_hold', 'brrrr', 'flip', 'str']);

interface HistogramBin {
  loPct: number; // inclusive lower edge, in percent (e.g. 0.6)
  hiPct: number; // exclusive upper edge, in percent
  count: number;
}

interface StatsResponse {
  total: number;
  onePercentPasses: number;
  medianRatioPct: number | null;
  markets: number;
  rentable: number;
  rentCalcPending: number;
  // Distribution of rent/price ratio for the "market pulse" / hero tape.
  histogram: HistogramBin[];
  thresholdPct: number; // the resolved rule line for `strategy`, in percent
  strategy: string;
  lastUpdated: string;
}

// Fixed display window for the ratio distribution: 0.2%..1.7% in 15 bins of 0.1%.
const HIST_LO = 0.2;
const HIST_HI = 1.7;
const HIST_BINS = 15;
const HIST_STEP = (HIST_HI - HIST_LO) / HIST_BINS;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const strategyParam = url.searchParams.get('strategy') || 'buy_hold';
  const strategy = STRATEGY_WHITELIST.has(strategyParam) ? strategyParam : 'buy_hold';
  const cacheKey = `${CACHE_KEY}:${strategy}`;
  try {
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) {
      return NextResponse.json(JSON.parse(cached), {
        headers: { 'X-Cache': 'HIT', 'Cache-Control': 'public, max-age=30, s-maxage=120' },
      });
    }
  } catch {
    /* ignore */
  }

  try {
    const result = await withSpan('home.stats', async () => {
      const client = await pool.connect();
      try {
        // Only count rent ratios for rows where:
        //   1. rent_calc_status = 'done' (rent has been computed)
        //   2. property type is rentable (not land/vacant/farm)
        // Total stays unfiltered so users see the full inventory size.
        // Per-distinct-property-type resolved target for the selected strategy
        // (resolve_rule is called ~13× here, then joined — not 688k× per row).
        const sql = `
          WITH rules AS (
            SELECT pt,
                   (SELECT target_ratio FROM resolve_rule(pt, 'standard', $1)) AS tr
            FROM (
              SELECT DISTINCT property_type AS pt
              FROM listings WHERE listing_type = 'for_sale' AND sale_type = 'standard'
            ) d
          ),
          base AS (
            SELECT
              l.price,
              l.estimated_rent,
              l.state,
              l.property_type,
              l.rent_calc_status,
              r.tr AS target_ratio,
              CASE WHEN l.price > 0 AND l.estimated_rent IS NOT NULL AND l.estimated_rent > 0
                        AND l.rent_calc_status = 'done'
                        AND public.is_rentable(l.property_type)
                   THEN l.estimated_rent / l.price END AS ratio
            FROM listings l
            LEFT JOIN rules r ON r.pt = l.property_type
            WHERE l.listing_type = 'for_sale'
              AND l.sale_type = 'standard'
              AND l.price > 10000
          )
          SELECT
            count(*)::int AS total,
            count(*) FILTER (WHERE ratio >= COALESCE(target_ratio, 0.01))::int AS one_pct,
            (
              percentile_cont(0.5) WITHIN GROUP (ORDER BY ratio)
              FILTER (WHERE ratio IS NOT NULL)
              * 100
            )::numeric(8,3) AS median_ratio_pct,
            count(DISTINCT state) FILTER (WHERE state IS NOT NULL)::int AS markets,
            count(*) FILTER (WHERE rent_calc_status = 'done' AND public.is_rentable(property_type))::int AS rentable,
            count(*) FILTER (WHERE rent_calc_status = 'pending')::int AS rent_calc_pending,
            (COALESCE((SELECT target_ratio FROM resolve_rule('DEFAULT', 'standard', $1)), 0.01) * 100)::numeric(6,2) AS threshold_pct,
            (
              SELECT coalesce(jsonb_agg(jsonb_build_object('bucket', bucket, 'count', c) ORDER BY bucket), '[]'::jsonb)
              FROM (
                SELECT width_bucket(ratio * 100, ${HIST_LO}, ${HIST_HI}, ${HIST_BINS}) AS bucket, count(*)::int AS c
                FROM base
                WHERE ratio IS NOT NULL
                GROUP BY 1
              ) h
            ) AS histogram
          FROM base
        `;
        return client.query(sql, [strategy]);
      } finally {
        client.release();
      }
    });

    const row = result.rows[0] ?? {};

    // Fold width_bucket output (0 = underflow, BINS+1 = overflow) into the
    // BINS display bins so the edges are never silently dropped.
    const counts = new Array<number>(HIST_BINS).fill(0);
    const rawBuckets: Array<{ bucket: number; count: number }> = Array.isArray(row.histogram)
      ? row.histogram
      : [];
    for (const b of rawBuckets) {
      const idx = Math.min(HIST_BINS, Math.max(1, Number(b.bucket))) - 1;
      counts[idx] += Number(b.count) || 0;
    }
    const histogram: HistogramBin[] = counts.map((count, i) => ({
      loPct: Number((HIST_LO + i * HIST_STEP).toFixed(2)),
      hiPct: Number((HIST_LO + (i + 1) * HIST_STEP).toFixed(2)),
      count,
    }));

    const payload: StatsResponse = {
      total: Number(row.total) || 0,
      onePercentPasses: Number(row.one_pct) || 0,
      medianRatioPct: row.median_ratio_pct != null ? Number(row.median_ratio_pct) : null,
      markets: Number(row.markets) || 0,
      rentable: Number(row.rentable) || 0,
      rentCalcPending: Number(row.rent_calc_pending) || 0,
      histogram,
      thresholdPct: row.threshold_pct != null ? Number(row.threshold_pct) : 1.0,
      strategy,
      lastUpdated: new Date().toISOString(),
    };

    redis.setex(cacheKey, CACHE_TTL_S, JSON.stringify(payload)).catch(() => {});

    return NextResponse.json(payload, {
      headers: { 'X-Cache': 'MISS', 'Cache-Control': 'public, max-age=30, s-maxage=120' },
    });
  } catch (err) {
    console.error('/api/stats error:', err);
    return NextResponse.json({ error: 'stats unavailable' }, { status: 500 });
  }
}
