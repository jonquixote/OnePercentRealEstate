import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

const getCachedMedianRent = unstable_cache(
  async () => {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY estimated_rent) AS median_rent
        FROM listings
        WHERE listing_type = 'for_sale'
          AND estimated_rent IS NOT NULL
          AND estimated_rent > 0
          AND listing_status NOT IN ('sold','stale','rental_misfiled')
      `);
      const medianRent = result.rows[0]?.median_rent;
      return medianRent != null ? Math.round(Number(medianRent)) : null;
    } finally {
      client.release();
    }
  },
  ['median-rent'],
  { revalidate: 600, tags: ['stats'] }
);

export async function GET() {
    try {
        const medianRent = await getCachedMedianRent();
        return NextResponse.json({ medianRent });
    } catch (error) {
        console.error('Stats median-rent error:', error);
        return NextResponse.json({ medianRent: null }, { status: 500 });
    }
}
