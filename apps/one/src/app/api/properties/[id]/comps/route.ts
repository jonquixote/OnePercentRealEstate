import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import redis from '@/lib/redis';

export const dynamic = 'force-dynamic';

const CACHE_TTL_SECONDS = 600;

export interface CompItem {
  id: string;
  address: string;
  price: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  estimated_rent: number | null;
  primary_photo: string | null;
  distance_m: number;
  status: string;
}

export interface CompsResponse {
  items: CompItem[];
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const cacheKey = `comps:${id}`;

  // Try cache first; tolerate Redis failures.
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return NextResponse.json(JSON.parse(cached) as CompsResponse, {
        headers: {
          'X-Cache': 'HIT',
          'Cache-Control': 'public, max-age=60, s-maxage=600',
        },
      });
    }
  } catch (error) {
    console.warn('Cache read error (comps):', error);
  }

  try {
    // Confirm the base property exists (and has geom we can search around).
    const baseRes = await pool.query(
      `SELECT id, geom IS NOT NULL AS has_geom
         FROM listings
        WHERE id = $1
        LIMIT 1`,
      [id]
    );

    if (baseRes.rowCount === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const baseRow = baseRes.rows[0];
    if (!baseRow.has_geom) {
      const empty: CompsResponse = { items: [] };
      try {
        await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(empty));
      } catch (error) {
        console.warn('Cache write error (comps):', error);
      }
      return NextResponse.json(empty, {
        headers: { 'X-Cache': 'MISS', 'Cache-Control': 'public, max-age=60, s-maxage=600' },
      });
    }

    const sql = `
      WITH base AS (
        SELECT geom, sqft, bedrooms, bathrooms, price
        FROM listings WHERE id = $1
      )
      SELECT
        l.id::text                                   AS id,
        l.address                                    AS address,
        l.city                                       AS city,
        l.state                                      AS state,
        l.zip_code                                   AS zip_code,
        l.price                                      AS price,
        l.bedrooms                                   AS bedrooms,
        l.bathrooms                                  AS bathrooms,
        l.sqft                                       AS sqft,
        l.year_built                                 AS year_built,
        l.primary_photo                              AS primary_photo,
        l.estimated_rent                             AS estimated_rent,
        l.listing_status                             AS listing_status,
        ST_Distance(l.geom::geography, base.geom::geography) AS distance_m,
        (
          COALESCE(ABS(l.sqft - base.sqft), 1000) / NULLIF(base.sqft, 0)::float +
          COALESCE(ABS(l.bedrooms - base.bedrooms), 2) +
          COALESCE(ABS(l.bathrooms - base.bathrooms), 2)
        )                                            AS dissimilarity
      FROM listings l, base
      WHERE l.id <> $1
        AND l.listing_type = 'for_sale'
        AND l.geom IS NOT NULL
        AND base.geom IS NOT NULL
        AND ST_DWithin(l.geom::geography, base.geom::geography, 5000)
      ORDER BY dissimilarity ASC NULLS LAST, distance_m ASC
      LIMIT 10;
    `;

    const result = await pool.query(sql, [id]);

    const items: CompItem[] = result.rows.map((row) => ({
      id: String(row.id),
      address: row.address ?? '',
      price: toNumber(row.price),
      bedrooms: toNumber(row.bedrooms),
      bathrooms: toNumber(row.bathrooms),
      sqft: toNumber(row.sqft),
      estimated_rent: toNumber(row.estimated_rent),
      primary_photo: row.primary_photo ?? null,
      distance_m: toNumber(row.distance_m) ?? 0,
      status: row.listing_status ?? 'active',
    }));

    const payload: CompsResponse = { items };

    // Cache write (tolerate Redis failures).
    try {
      await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(payload));
    } catch (error) {
      console.warn('Cache write error (comps):', error);
    }

    return NextResponse.json(payload, {
      headers: {
        'X-Cache': 'MISS',
        'Cache-Control': 'public, max-age=60, s-maxage=600',
      },
    });
  } catch (error) {
    console.error('Comps API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
