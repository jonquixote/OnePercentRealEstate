import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withSpan } from '@/lib/tracing';

export const dynamic = 'force-dynamic';

const MAX_IDS = 100;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const ids = searchParams.get('ids');

    if (!ids) return NextResponse.json([]);

    const idArray = ids
      .split(',')
      .map(s => s.trim())
      .filter(s => /^\d+$/.test(s))
      .slice(0, MAX_IDS);

    if (idArray.length === 0) return NextResponse.json([]);

    const placeholders = idArray.map((_, i) => `$${i + 1}`).join(', ');

    const client = await pool.connect();
    try {
      const result = await withSpan(
        'properties.by_ids',
        () =>
          client.query(
            `
            SELECT
              id::text AS id,
              address,
              price AS listing_price,
              estimated_rent,
              listing_status AS status,
              primary_photo,
              bedrooms,
              bathrooms,
              sqft,
              year_built,
              hoa_fee
            FROM listings
            WHERE id IN (${placeholders})
            `,
            idArray
          ),
        { 'ids.count': idArray.length },
      );

      const rows = result.rows.map((row: any) => ({
        id: row.id,
        address: row.address,
        listing_price: row.listing_price != null ? Number(row.listing_price) : null,
        estimated_rent: row.estimated_rent != null ? Number(row.estimated_rent) : null,
        status: row.status ?? 'active',
        images: row.primary_photo ? [row.primary_photo] : [],
        specs: {
          bedrooms: row.bedrooms != null ? Number(row.bedrooms) : null,
          bathrooms: row.bathrooms != null ? Number(row.bathrooms) : null,
          sqft: row.sqft != null ? Number(row.sqft) : null,
          year_built: row.year_built != null ? Number(row.year_built) : null,
          hoa_fee: row.hoa_fee != null ? Number(row.hoa_fee) : null,
        },
      }));

      return NextResponse.json(rows);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error fetching properties:', error);
    return NextResponse.json({ error: 'Failed to fetch properties' }, { status: 500 });
  }
}
