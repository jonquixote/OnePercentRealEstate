import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const ids = searchParams.get('ids');

        if (!ids) {
            return NextResponse.json([]);
        }

        const idArray = ids.split(',').filter(id => id.trim());
        if (idArray.length === 0) {
            return NextResponse.json([]);
        }

        const client = await pool.connect();

        // Create parameterized placeholders for the IN clause
        const placeholders = idArray.map((_, i) => `$${i + 1}`).join(', ');

        const result = await client.query(`
            SELECT 
                id,
                address,
                COALESCE(price, (raw_data->>'list_price')::numeric) as listing_price,
                COALESCE(estimated_rent, (raw_data->>'estimated_rent')::numeric) as estimated_rent,
                raw_data as financial_snapshot,
                'active' as status,
                CASE 
                    WHEN raw_data->>'primary_photo' IS NOT NULL 
                    THEN ARRAY[raw_data->>'primary_photo']
                    ELSE ARRAY[]::text[]
                END as images,
                raw_data
            FROM listings
            WHERE id IN (${placeholders})
        `, idArray);

        client.release();

        return NextResponse.json(result.rows);

    } catch (error) {
        console.error('Error fetching properties:', error);
        return NextResponse.json({ error: 'Failed to fetch properties' }, { status: 500 });
    }
}
