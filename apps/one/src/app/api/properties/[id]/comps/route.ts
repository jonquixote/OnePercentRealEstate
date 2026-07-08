import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!id || isNaN(Number(id))) {
    return NextResponse.json({ error: 'Invalid property id' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    // Look up the listing's coordinates + specs
    const listingRes = await client.query(`
      SELECT latitude, longitude, bedrooms, city, state
      FROM listings
      WHERE id = $1
    `, [id]);

    if (listingRes.rows.length === 0) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }

    const listing = listingRes.rows[0];
    const lat = listing.latitude != null ? Number(listing.latitude) : null;
    const lng = listing.longitude != null ? Number(listing.longitude) : null;
    const beds = listing.bedrooms != null ? Number(listing.bedrooms) : null;
    const city = listing.city;
    const state = listing.state;

    if (lat == null || lng == null) {
      return NextResponse.json({ error: 'Property has no coordinates' }, { status: 400 });
    }

    // Find sold comps within ~30mi (0.5 deg lat/lng), same city preferred
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
        -- source feeds placeholder/typo future dates (2099-01-01 pending
        -- sentinel, etc.) — they must not anchor ARV.
        AND sold_date <= now()
      ORDER BY
        CASE WHEN city = $3 THEN 0 ELSE 1 END,
        ABS(bedrooms - COALESCE($4::numeric, bedrooms)) ASC,
        distance_meters ASC
      LIMIT 20
    `, [lng, lat, city ?? '', beds]);

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

    // Compute summary stats
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
    // P75 $/sqft is the ARV anchor per the Track B spec (§B4): ARV =
    // p75_ppsf × subject sqft. Requires ≥5 priced+sized comps to be
    // meaningful — below that the UI should fall back, not extrapolate.
    const p75Ppsf = ppsfList.length >= 5
      ? ppsfList[Math.min(ppsfList.length - 1, Math.floor(ppsfList.length * 0.75))]
      : null;

    return NextResponse.json({
      comps,
      summary: {
        total: comps.length,
        median_sold_price: medianPrice,
        avg_price_per_sqft: avgPpsf > 0 ? Math.round(avgPpsf * 100) / 100 : null,
        p75_price_per_sqft: p75Ppsf != null ? Math.round(p75Ppsf * 100) / 100 : null,
        source: 'sold_listings',
      },
    });
  } catch (error) {
    console.error('Comps fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch comps' }, { status: 500 });
  } finally {
    client.release();
  }
}
