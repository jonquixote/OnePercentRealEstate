import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { withSpan } from '@/lib/tracing';

export const dynamic = 'force-dynamic';

const MAX_IDS = 100;
// Growth 1.3: Compare(>2) is the paid gate. Free accounts compare at most
// COMPARE_FREE_MAX; subscribers get the wider COMPARE_MAX table.
const COMPARE_FREE_MAX = 2;
const COMPARE_PRO_MAX = 4;

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

    // Server-side compare gate: enforced regardless of client cap, so a free
    // user cannot bypass it via a hand-crafted /compare?ids=... URL.
    if (searchParams.get('compare') === '1') {
      const user = await getSessionUser();
      const isPro = user?.tier === 'pro';
      const limit = isPro ? COMPARE_PRO_MAX : COMPARE_FREE_MAX;
      if (idArray.length > limit) {
        return NextResponse.json(
          {
            error: 'compare_limit',
            limit,
            pro: isPro,
            message: `Free accounts can compare up to ${limit} properties. Upgrade to compare more.`,
          },
          { status: 402 },
        );
      }
    }

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
          images,
          media_blur,
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

    const rows = result.rows.map((row: any) => {
      const images: string[] = (() => {
        if (Array.isArray(row.images) && row.images.length > 0) {
          return row.images.filter((url: any) => typeof url === 'string' && url.length > 0);
        }
        if (row.primary_photo) return [row.primary_photo];
        return [];
      })();

      return {
      id: row.id,
      address: row.address,
      listing_price: row.listing_price != null ? Number(row.listing_price) : null,
      estimated_rent: row.estimated_rent != null ? Number(row.estimated_rent) : null,
      status: row.status ?? 'active',
      images,
      media_blur: row.media_blur ?? null,
      specs: {
        bedrooms: row.bedrooms != null ? Number(row.bedrooms) : null,
        bathrooms: row.bathrooms != null ? Number(row.bathrooms) : null,
        sqft: row.sqft != null ? Number(row.sqft) : null,
        year_built: row.year_built != null ? Number(row.year_built) : null,
        hoa_fee: row.hoa_fee != null ? Number(row.hoa_fee) : null,
      },
    };});

      return NextResponse.json(rows);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error fetching properties:', error);
    return NextResponse.json({ error: 'Failed to fetch properties' }, { status: 500 });
  }
}
