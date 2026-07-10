import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const client = await pool.connect();
        try {
            const result = await client.query(`
                SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY estimated_rent) AS median_rent
                FROM listings
                WHERE listing_type = 'for_sale'
                  AND estimated_rent IS NOT NULL
                  AND estimated_rent > 0
            `);
            const medianRent = result.rows[0]?.median_rent;
            return NextResponse.json({ medianRent: medianRent != null ? Math.round(Number(medianRent)) : null });
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Stats median-rent error:', error);
        return NextResponse.json({ medianRent: null }, { status: 500 });
    }
}
