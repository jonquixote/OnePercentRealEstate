import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const bounds = searchParams.get('bounds'); // "minLng,minLat,maxLng,maxLat"
    const zoom = parseFloat(searchParams.get('zoom') || '0');

    if (!bounds) {
        return NextResponse.json({ type: 'FeatureCollection', features: [] });
    }

    const [minLng, minLat, maxLng, maxLat] = bounds.split(',').map(parseFloat);

    const client = await pool.connect();
    try {
        // Ensure PostGIS extension exists (idempotent, fast)
        await client.query('CREATE EXTENSION IF NOT EXISTS postgis');

        let query = '';
        let params: any[] = [];

        // Grid size decreases as zoom increases (higher zoom = smaller grid cells)
        // Zoom 0-20. 
        // At zoom 4, grid size ~ 2 degrees?
        // At zoom 10, grid size ~ 0.05 degrees?
        // Formula: 360 / (2^zoom) * constant
        // Let's use a simpler heuristic for ST_SnapToGrid

        let gridSize = 0.5; // Default for low zoom
        if (zoom > 4) gridSize = 0.2;
        if (zoom > 6) gridSize = 0.05;
        if (zoom > 8) gridSize = 0.02;
        if (zoom > 10) gridSize = 0.005;
        if (zoom > 12) gridSize = 0.001;

        if (zoom < 6) {
            // Broad Clustering (State/Region level) - Optimized for "Whole USA" view
            // If we have millions, ST_SnapToGrid on all might still be slow without index.
            // Ideally we use a materialized view. For now, we query live but with loose filtering.
            query = `
             SELECT 
               count(*) as count,
               ST_X(ST_Centroid(ST_Collect(geometry))) as lng,
               ST_Y(ST_Centroid(ST_Collect(geometry))) as lat
             FROM listings
             WHERE longitude BETWEEN $1 AND $2 AND latitude BETWEEN $3 AND $4
               AND listing_status = 'FOR_SALE'
             GROUP BY ST_SnapToGrid(geometry, $5)
           `;
            params = [minLng, maxLng, minLat, maxLat, 2.0]; // Larger grid for overview
        } else {
            // Dynamic Grid Clustering
            query = `
            SELECT 
              count(*) as count,
              ST_X(ST_Centroid(ST_Collect(geometry))) as lng,
              ST_Y(ST_Centroid(ST_Collect(geometry))) as lat,
              -- If count is 1, get the actual property details to prevent infinite zooming on single properties
              CASE WHEN count(*) = 1 THEN MAX(id::text) ELSE NULL END as property_id,
              CASE WHEN count(*) = 1 THEN MAX(price) ELSE NULL END as price,
              CASE WHEN count(*) = 1 THEN MAX(address) ELSE NULL END as address
            FROM listings
            WHERE longitude BETWEEN $1 AND $2 AND latitude BETWEEN $3 AND $4
              AND listing_status = 'FOR_SALE'
             GROUP BY ST_SnapToGrid(geometry, $5)
          `;
            params = [minLng, maxLng, minLat, maxLat, gridSize];
        }

        /* 
           Note: We need to ensure logic handles the "listing" table having a 'geometry' column or cast on fly.
           The listings table currently has latitude/longitude columns.
           We should construct geometry on the fly: ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
        */
        const geometryQuery = query.replace(/geometry/g, 'ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)');

        const res = await client.query(geometryQuery, params);

        const features = res.rows.map(row => ({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [row.lng, row.lat]
            },
            properties: {
                cluster: parseInt(row.count) > 1,
                point_count: parseInt(row.count),
                point_count_abbreviated: abbreviateNumber(parseInt(row.count)),
                id: row.property_id,
                price: row.price,
                address: row.address
            }
        }));

        return NextResponse.json({
            type: 'FeatureCollection',
            features
        });

    } catch (error: any) {
        console.error("Clustering Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    } finally {
        client.release();
    }
}

function abbreviateNumber(value: number): string {
    if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
    if (value >= 1000) return (value / 1000).toFixed(1) + 'K';
    return value.toString();
}
