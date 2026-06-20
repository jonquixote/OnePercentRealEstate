import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import redis from '@/lib/redis';
import { withSpan } from '@/lib/tracing';

export const dynamic = 'force-dynamic';

const CACHE_KEY = 'home:featured:v1';
const CACHE_TTL_S = 600;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '6', 10) || 6, 1), 12);
  const cacheKey = `${CACHE_KEY}:${limit}`;

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
              l.bedrooms,
              l.bathrooms,
              l.sqft,
              l.primary_photo,
              l.property_type,
              l.created_at,
              CASE WHEN l.price > 0 AND l.estimated_rent IS NOT NULL AND l.estimated_rent > 0
                   THEN (l.estimated_rent / l.price * 100)::numeric(6,2) END AS ratio_pct
            FROM listings l
            LEFT JOIN property_type_rules ptr ON ptr.property_type = l.property_type
            WHERE l.listing_type = 'for_sale'
              AND l.sale_type = 'standard'
              AND l.price > 0
              AND l.primary_photo IS NOT NULL
              AND public.is_rentable(l.property_type)
              AND l.rent_calc_status = 'done'
              AND l.price > 0
              AND l.estimated_rent > 0
              AND (l.estimated_rent / l.price) >= COALESCE(ptr.target_ratio, 0.01)
          )
          SELECT id, address, city, state, price, estimated_rent,
                 bedrooms, bathrooms, sqft, primary_photo, property_type, ratio_pct
          FROM ranked
          ORDER BY
            (ratio_pct IS NOT NULL) DESC,
            ratio_pct DESC NULLS LAST,
            created_at DESC NULLS LAST
          LIMIT $1
        `;
        return client.query(sql, [limit]);
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
      bedrooms: row.bedrooms != null ? Number(row.bedrooms) : null,
      bathrooms: row.bathrooms != null ? Number(row.bathrooms) : null,
      sqft: row.sqft != null ? Number(row.sqft) : null,
      primary_photo: row.primary_photo,
      property_type: row.property_type ?? null,
      ratio_pct: row.ratio_pct != null ? Number(row.ratio_pct) : null,
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
