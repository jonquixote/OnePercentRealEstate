import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import redis from '@/lib/redis';
import { withSpan } from '@/lib/tracing';

export const dynamic = 'force-dynamic';

const CACHE_KEY = 'home:featured:v2';
const CACHE_TTL_S = 600;
const STRATEGY_WHITELIST = new Set(['buy_hold', 'brrrr', 'flip', 'str']);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '6', 10) || 6, 1), 12);
  const strategyParam = searchParams.get('strategy') || 'buy_hold';
  const strategy = STRATEGY_WHITELIST.has(strategyParam) ? strategyParam : 'buy_hold';
  const cacheKey = `${CACHE_KEY}:${limit}:${strategy}`;

  try {
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) {
      return NextResponse.json(JSON.parse(cached), {
        headers: { 'X-Cache': 'HIT', 'Cache-Control': 'public, max-age=300, s-maxage=600' },
      });
    }
  } catch {
    /* ignore */
  }

  try {
    const result = await withSpan('home.featured', async () => {
      const client = await pool.connect();
      try {
        // Strategy: prefer rows with a real 1% pass; fall back to other
        // photo-having listings sorted by ratio DESC then created_at DESC
        // when not enough qualifying rows exist. This keeps the homepage
        // strip populated during the rent-calc backfill window when most
        // estimated_rent values are still NULL or 0.
        //
        // Non-rentable types (land, vacant lots, farms) are excluded so
        // they never appear in featured deals. Only rows with completed
        // rent calculations are considered for ratio ranking.
        const sql = `
          WITH ranked AS (
            SELECT
              l.id::text AS id,
              l.address,
              l.city,
              l.state,
              l.price,
              l.estimated_rent,
              l.rent_low,
              l.rent_high,
              l.rent_model_version,
              l.bedrooms,
              l.bathrooms,
              l.sqft,
              l.primary_photo,
              l.property_type,
              l.created_at,
              CASE WHEN l.price > 0 AND l.estimated_rent IS NOT NULL AND l.estimated_rent > 0
                   THEN (l.estimated_rent / l.price * 100)::numeric(6,2) END AS ratio_pct,
              -- resolved per-(type, sale_type) buy-hold target, as percent, so the
              -- gauge draws the listing's actual rule line (not a flat 1%).
              (COALESCE((SELECT target_ratio FROM resolve_rule(l.property_type, l.sale_type, $2)), 0.01) * 100)::numeric(6,2) AS target_ratio_pct
            FROM listings l
            WHERE l.listing_type = 'for_sale'
              AND l.sale_type = 'standard'
              -- Lifecycle: rank only live inventory. Without this, misfiled
              -- rentals (whose "rent" is really the list price) post absurd
              -- ratios and dominate this ratio-DESC strip — the original complaint.
              AND l.listing_status = 'active'
              AND l.price > 10000
              AND l.primary_photo IS NOT NULL
              AND public.is_rentable(l.property_type)
              AND l.rent_calc_status = 'done'
              AND l.estimated_rent > 0
              AND (l.estimated_rent / l.price) >= COALESCE((SELECT target_ratio FROM resolve_rule(l.property_type, l.sale_type, $2)), 0.01)
          )
          SELECT id, address, city, state, price, estimated_rent,
                 rent_low, rent_high, rent_model_version,
                 bedrooms, bathrooms, sqft, primary_photo, property_type, ratio_pct, target_ratio_pct
          FROM ranked
          ORDER BY
            (ratio_pct IS NOT NULL) DESC,
            ratio_pct DESC NULLS LAST,
            created_at DESC NULLS LAST
          LIMIT $1
        `;
        return client.query(sql, [limit, strategy]);
      } finally {
        client.release();
      }
    });

    const items = result.rows.map((row: any) => ({
      id: row.id,
      address: row.address,
      city: row.city,
      state: row.state,
      price: row.price != null ? Number(row.price) : null,
      estimated_rent: row.estimated_rent != null ? Number(row.estimated_rent) : null,
      rent_low: row.rent_low != null ? Number(row.rent_low) : null,
      rent_high: row.rent_high != null ? Number(row.rent_high) : null,
      rent_model_version: row.rent_model_version ?? null,
      bedrooms: row.bedrooms != null ? Number(row.bedrooms) : null,
      bathrooms: row.bathrooms != null ? Number(row.bathrooms) : null,
      sqft: row.sqft != null ? Number(row.sqft) : null,
      primary_photo: row.primary_photo,
      property_type: row.property_type ?? null,
      ratio_pct: row.ratio_pct != null ? Number(row.ratio_pct) : null,
      target_ratio_pct: row.target_ratio_pct != null ? Number(row.target_ratio_pct) : null,
    }));

    const payload = { items };
    redis.setex(cacheKey, CACHE_TTL_S, JSON.stringify(payload)).catch(() => {});

    return NextResponse.json(payload, {
      headers: { 'X-Cache': 'MISS', 'Cache-Control': 'public, max-age=300, s-maxage=600' },
    });
  } catch (err) {
    console.error('/api/featured error:', err);
    return NextResponse.json({ error: 'featured unavailable' }, { status: 500 });
  }
}
