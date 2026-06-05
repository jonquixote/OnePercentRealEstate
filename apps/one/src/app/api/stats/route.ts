import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import redis from '@/lib/redis';
import { withSpan } from '@/lib/tracing';

export const dynamic = 'force-dynamic';

const CACHE_KEY = 'home:stats:v1';
const CACHE_TTL_S = 300;

interface StatsResponse {
  total: number;
  onePercentPasses: number;
  medianRatioPct: number | null;
  markets: number;
  lastUpdated: string;
}

export async function GET() {
  try {
    const cached = await redis.get(CACHE_KEY).catch(() => null);
    if (cached) {
      return NextResponse.json(JSON.parse(cached), {
        headers: { 'X-Cache': 'HIT', 'Cache-Control': 'public, max-age=60, s-maxage=300' },
      });
    }
  } catch {
    /* ignore */
  }

  try {
    const result = await withSpan('home.stats', async () => {
      const client = await pool.connect();
      try {
        // estimated_rent can be 0 when ML returns no signal — those rows
        // would skew the median to 0 and mask the real distribution.
        // ratio is computed only when estimated_rent is positive.
        const sql = `
          WITH base AS (
            SELECT
              price,
              estimated_rent,
              state,
              CASE WHEN price > 0 AND estimated_rent IS NOT NULL AND estimated_rent > 0
                   THEN estimated_rent / price END AS ratio
            FROM listings
            WHERE listing_type = 'for_sale'
          )
          SELECT
            count(*)::int AS total,
            count(*) FILTER (WHERE ratio >= 0.01)::int AS one_pct,
            (
              percentile_cont(0.5) WITHIN GROUP (ORDER BY ratio)
              FILTER (WHERE ratio IS NOT NULL)
              * 100
            )::numeric(8,3) AS median_ratio_pct,
            count(DISTINCT state) FILTER (WHERE state IS NOT NULL)::int AS markets
          FROM base
        `;
        return client.query(sql);
      } finally {
        client.release();
      }
    });

    const row = result.rows[0] ?? {};
    const payload: StatsResponse = {
      total: Number(row.total) || 0,
      onePercentPasses: Number(row.one_pct) || 0,
      medianRatioPct: row.median_ratio_pct != null ? Number(row.median_ratio_pct) : null,
      markets: Number(row.markets) || 0,
      lastUpdated: new Date().toISOString(),
    };

    redis.setex(CACHE_KEY, CACHE_TTL_S, JSON.stringify(payload)).catch(() => {});

    return NextResponse.json(payload, {
      headers: { 'X-Cache': 'MISS', 'Cache-Control': 'public, max-age=60, s-maxage=300' },
    });
  } catch (err) {
    console.error('/api/stats error:', err);
    return NextResponse.json({ error: 'stats unavailable' }, { status: 500 });
  }
}
