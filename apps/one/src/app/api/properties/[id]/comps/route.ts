import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { cached, CACHE_TTL } from '@/lib/cache';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!id || isNaN(Number(id))) {
    return NextResponse.json({ error: 'Invalid property id' }, { status: 400 });
  }

  let data;
  try {
    data = await cached(`comps:${id}`, CACHE_TTL.comps, async () => {
    const client = await pool.connect();
    try {
      const listingRes = await client.query(`
        SELECT latitude, longitude, bedrooms, city, state
        FROM listings
        WHERE id = $1
      `, [id]);

      if (listingRes.rows.length === 0) {
        return null;
      }

      const listing = listingRes.rows[0];
      const lat = listing.latitude != null ? Number(listing.latitude) : null;
      const lng = listing.longitude != null ? Number(listing.longitude) : null;
      const beds = listing.bedrooms != null ? Number(listing.bedrooms) : null;
      const city = listing.city;
      const state = listing.state;

      if (lat == null || lng == null) {
        return null;
      }

      const compsRes = await client.query(`
        SELECT
          id, address, city, state, zip_code,
          sold_price, sold_date, list_price,
          bedrooms, bathrooms, sqft,
          latitude, longitude,
          ROUND(
            ST_Distance(
              geom,
              ST_SetSRID(ST_MakePoint($1::float, $2::float), 4326)::geography
            )::numeric
          ) AS distance_meters
        FROM sold_listings
        WHERE latitude BETWEEN $2::float - 0.5 AND $2::float + 0.5
          AND longitude BETWEEN $1::float - 0.5 AND $1::float + 0.5
          AND sold_price IS NOT NULL AND sold_price > 0
          AND sold_date IS NOT NULL
          AND sold_date <= now()
        ORDER BY
          CASE WHEN city = $3 THEN 0 ELSE 1 END,
          ABS(bedrooms - $4::numeric) ASC,
          distance_meters ASC
        LIMIT 20
      `, [lng, lat, city ?? '', beds ?? 3]);

      const comps = compsRes.rows.map((r: any) => ({
        id: r.id,
        address: r.address,
        city: r.city,
        state: r.state,
        zip_code: r.zip_code,
        sold_price: r.sold_price ? Number(r.sold_price) : null,
        sold_date: r.sold_date,
        list_price: r.list_price ? Number(r.list_price) : null,
        bedrooms: r.bedrooms ? Number(r.bedrooms) : null,
        bathrooms: r.bathrooms ? Number(r.bathrooms) : null,
        sqft: r.sqft ? Number(r.sqft) : null,
        distance_meters: r.distance_meters ? Number(r.distance_meters) : null,
      }));

      const prices = comps.map((c: any) => c.sold_price).filter(Boolean);
      const medianPrice = prices.length > 0
        ? prices.sort((a: number, b: number) => a - b)[Math.floor(prices.length / 2)]
        : null;
      const ppsfList = comps
        .filter((c: any) => c.sold_price && c.sqft)
        .map((c: any) => c.sold_price / c.sqft)
        .sort((a: number, b: number) => a - b);
      const avgPpsf = ppsfList.length > 0
        ? ppsfList.reduce((a: number, b: number) => a + b, 0) / ppsfList.length
        : 0;
      const p75Ppsf = ppsfList.length >= 5
        ? ppsfList[Math.min(ppsfList.length - 1, Math.floor(ppsfList.length * 0.75))]
        : null;

      return {
        comps,
        summary: {
          total: comps.length,
          median_sold_price: medianPrice,
          avg_price_per_sqft: avgPpsf > 0 ? Math.round(avgPpsf * 100) / 100 : null,
          p75_price_per_sqft: p75Ppsf != null ? Math.round(p75Ppsf * 100) / 100 : null,
          source: 'sold_listings',
        },
      };
    } catch (error) {
      console.error('Comps fetch error:', error);
      throw error;
    } finally {
      client.release();
    }
  });
  } catch (error) {
    console.error('Comps route error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: 'Property not found or no comps' }, { status: 404 });
  }

  return NextResponse.json(data);
}
