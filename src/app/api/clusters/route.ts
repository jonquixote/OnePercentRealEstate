import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const min_lat = searchParams.get('min_lat');
    const max_lat = searchParams.get('max_lat');
    const min_lon = searchParams.get('min_lon');
    const max_lon = searchParams.get('max_lon');
    const zoom = searchParams.get('zoom');

    if (!min_lat || !max_lat || !min_lon || !max_lon || !zoom) {
        return NextResponse.json({ error: 'Missing bounds or zoom' }, { status: 400 });
    }

    try {
        const sql = `
            SELECT get_property_clusters(
                $1::numeric, 
                $2::numeric, 
                $3::numeric, 
                $4::numeric, 
                $5::integer
            ) as clusters
        `;
        const values = [min_lat, min_lon, max_lat, max_lon, zoom];

        const result = await pool.query(sql, values);
        const features = result.rows[0].clusters || [];

        return NextResponse.json({
            type: 'FeatureCollection',
            features: features
        });
    } catch (error: any) {
        console.error('Cluster API Error:', error);
        return NextResponse.json({ error: 'Internal Server Error', details: error.message }, { status: 500 });
    }
}
