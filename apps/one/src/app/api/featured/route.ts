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
        const sql = `
          SELECT
            id::text AS id,
            address,
            city,
            state,
            price,
            estimated_rent,
            bedrooms,
            bathrooms,
            sqft,
            primary_photo,
            CASE WHEN price > 0 AND estimated_rent IS NOT NULL
                 THEN (estimated_rent / price * 100)::numeric(6,2) END AS ratio_pct
          FROM listings
          WHERE listing_type = 'for_sale'
            AND price > 0
            AND estimated_rent IS NOT NULL
            AND primary_photo IS NOT NULL
            AND (estimated_rent / price) >= 0.01
          ORDER BY (estimated_rent / price) DESC NULLS LAST
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
