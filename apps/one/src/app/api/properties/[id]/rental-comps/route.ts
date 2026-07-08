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
    const listingRes = await client.query(`
      SELECT latitude, longitude, bedrooms, city, zip_code
      FROM listings WHERE id = $1
    `, [id]);

    if (listingRes.rows.length === 0) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }

    const listing = listingRes.rows[0];
    const lat = listing.latitude != null ? Number(listing.latitude) : null;
    const lng = listing.longitude != null ? Number(listing.longitude) : null;
    const beds = listing.bedrooms != null ? Number(listing.bedrooms) : null;
    const zip = listing.zip_code;

    if (lat == null || lng == null) {
      return NextResponse.json({ error: 'Property has no coordinates' }, { status: 400 });
    }

    const compsRes = await client.query(`
      SELECT
        id, address, city, zip_code,
        price, bedrooms, bathrooms, sqft, year_built, hoa_fee,
        days_on_market, source, listing_date,
        latitude, longitude,
        ROUND(
          ST_Distance(
            location,
            ST_SetSRID(ST_MakePoint($1::float, $2::float), 4326)::geography
          )::numeric
        ) AS distance_meters
      FROM rental_listings
      WHERE latitude BETWEEN $2::float - 0.3 AND $2::float + 0.3
        AND longitude BETWEEN $1::float - 0.3 AND $1::float + 0.3
        AND price IS NOT NULL AND price > 0
        AND listing_date >= CURRENT_DATE - INTERVAL '180 days'
      ORDER BY
        CASE WHEN zip_code = $3 THEN 0 ELSE 1 END,
        ABS(bedrooms - COALESCE($4::numeric, 3)) ASC,
        distance_meters ASC
      LIMIT 20
    `, [lng, lat, zip ?? '', beds ?? 3]);

    const comps = compsRes.rows.map((r: any) => ({
      id: r.id,
      address: r.address,
      city: r.city,
      zip_code: r.zip_code,
      price: r.price != null ? Number(r.price) : null,
      bedrooms: r.bedrooms != null ? Number(r.bedrooms) : null,
      bathrooms: r.bathrooms != null ? Number(r.bathrooms) : null,
      sqft: r.sqft != null ? Number(r.sqft) : null,
      year_built: r.year_built != null ? Number(r.year_built) : null,
      hoa_fee: r.hoa_fee != null ? Number(r.hoa_fee) : null,
      days_on_market: r.days_on_market != null ? Number(r.days_on_market) : null,
      source: r.source,
      listing_date: r.listing_date,
      distance_meters: r.distance_meters != null ? Number(r.distance_meters) : null,
    }));

    const prices = comps.map((c: any) => c.price).filter(Boolean);
    const sortedPrices = [...prices].sort((a: number, b: number) => a - b);
    const medianRent = sortedPrices.length > 0
      ? sortedPrices.length % 2 === 0
        ? (sortedPrices[sortedPrices.length / 2 - 1] + sortedPrices[sortedPrices.length / 2]) / 2
        : sortedPrices[Math.floor(sortedPrices.length / 2)]
      : null;
    const ppsfList = comps
      .filter((c: any) => c.price && c.sqft)
      .map((c: any) => c.price / c.sqft)
      .sort((a: number, b: number) => a - b);
    const avgPpsf = ppsfList.length > 0
      ? ppsfList.reduce((a: number, b: number) => a + b, 0) / ppsfList.length
      : null;

    return NextResponse.json({
      comps,
      summary: {
        total: comps.length,
        median_rent: medianRent,
        avg_price_per_sqft: avgPpsf != null ? Math.round(avgPpsf * 100) / 100 : null,
        source: 'rental_listings',
      },
    });
  } catch (error) {
    console.error('Rental comps fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch rental comps' }, { status: 500 });
  } finally {
    client.release();
  }
}
