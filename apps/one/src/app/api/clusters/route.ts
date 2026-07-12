import { NextResponse, NextRequest } from 'next/server';
import { z } from 'zod';
import pool from '@/lib/db';
import { safeErrorResponse } from '@/lib/api-error';
import { parseQuery, numericParam } from '@/lib/api-utils';
import { clustersLimiter, checkRateLimit } from '@/lib/rate-limit';

const BoundsSchema = z.object({
  min_lat: numericParam(-90, 90),
  max_lat: numericParam(-90, 90),
  min_lon: numericParam(-180, 180),
  max_lon: numericParam(-180, 180),
  zoom: numericParam(0, 22),
});

export async function GET(req: NextRequest) {
    const parsed = parseQuery(BoundsSchema, req);
    if (!parsed.ok) return parsed.response;

    const { min_lat, max_lat, min_lon, max_lon, zoom } = parsed.data;

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rl = await checkRateLimit(clustersLimiter, ip);
    if (!rl.allowed) {
        return NextResponse.json(
            { error: 'Rate limit exceeded' },
            { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } }
        );
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
} catch (error) {
    console.error('Cluster API Error:', error);
    return safeErrorResponse(error, 500);
  }
}
