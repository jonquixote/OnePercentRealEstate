import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const client = await pool.connect();
        try {
            const result = await client.query(`
                SELECT count(*)::int AS count
                FROM listings
                WHERE listing_type = 'for_sale'
                  AND sale_type = 'standard'
                  AND price > 10000
                  AND price_cut_pct > 0
            `);
            return NextResponse.json({ count: result.rows[0]?.count ?? 0 });
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Stats cuts error:', error);
        return NextResponse.json({ count: 0 }, { status: 500 });
    }
}
