import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { lat, lon, beds, baths, sqft, zip_code, property_type } = body;

        if (!lat || !lon) {
            return NextResponse.json({ error: 'Missing lat/lon' }, { status: 400 });
        }

        // Call the PostgreSQL function for smart rent estimation
        // v2: Now includes property_type for non-rentable detection (land, lots, vacant)
        const sql = `
            SELECT calculate_smart_rent(
                $1::numeric, 
                $2::numeric, 
                $3::integer, 
                $4::numeric, 
                $5::integer, 
                $6::text,
                $7::text
            ) as data
        `;

        const values = [
            lat,
            lon,
            beds || null, // Don't default to 3 - let function handle null
            baths || null,
            sqft || null,
            zip_code || null,
            property_type || null
        ];

        const result = await pool.query(sql, values);

        if (result.rows.length === 0) {
            return NextResponse.json({ error: 'Estimation failed' }, { status: 500 });
        }

        const data = result.rows[0].data;

        // Transform the result to match frontend expectations
        const responseData = {
            estimated_rent: data.active_estimate || data.smart_estimate || data.comps_avg || data.hud_fmr,
            hud_fmr: data.hud_fmr,
            comps_avg: data.comps_avg,
            smart_estimate: data.smart_estimate,
            confidence_score: data.confidence_score || 0.5,
            comps_used: data.comp_count || 0,
            method: data.method || 'unknown',
            comps: data.comps || [],
            safmr_rent: data.hud_fmr, // For backwards compatibility
            property_type: data.property_type,
            reason: data.reason // Added for non-rentable explanation
        };

        return NextResponse.json(responseData);

    } catch (e: any) {
        console.error('Estimate rent error:', e);
        return NextResponse.json({ error: 'Internal Server Error', details: e.message }, { status: 500 });
    }
}
