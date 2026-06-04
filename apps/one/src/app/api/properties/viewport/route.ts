
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import pool from '@/lib/db';
import redis from '@/lib/redis';
import { checkRateLimit, viewportLimiter } from '@/lib/rate-limit';
import { withSpan } from '@/lib/tracing';

// Validation Schema
const ViewportSchema = z.object({
    north: z.coerce.number().min(-90).max(90),
    south: z.coerce.number().min(-90).max(90),
    east: z.coerce.number().min(-180).max(180),
    west: z.coerce.number().min(-180).max(180),
    zoom: z.coerce.number().min(0).max(24),
    // Filters
    minPrice: z.coerce.number().optional(),
    maxPrice: z.coerce.number().optional(),
    beds: z.coerce.number().optional(),
    baths: z.coerce.number().optional(),
    propertyType: z.string().optional(),
    status: z.string().optional(),
});

type ViewportParams = z.infer<typeof ViewportSchema>;

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';

    // Rate Limiting
    try {
        if (ip !== 'unknown') {
            const limit = await checkRateLimit(viewportLimiter, ip);
            if (!limit.allowed) {
                return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
            }
        }
    } catch (e) {
        // Fail open on rate limiter error
        console.warn('Rate limiter error:', e);
    }

    // Validate input
    const result = ViewportSchema.safeParse(Object.fromEntries(searchParams));

    if (!result.success) {
        return NextResponse.json(
            { error: 'Invalid parameters', details: result.error.format() },
            { status: 400 }
        );
    }

    const params = result.data;
    const startTime = Date.now();

    // Sort keys to generate consistent cache key
    const cacheKey = `viewport:${Object.keys(params).sort().map(k => `${k}=${params[k as keyof ViewportParams]}`).join('&')}`;

    // Try fetching from cache
    try {
        const cached = await redis.get(cacheKey);
        if (cached) {
            return NextResponse.json(JSON.parse(cached), {
                headers: {
                    'X-Cache': 'HIT',
                    'Cache-Control': 'public, max-age=60, s-maxage=300'
                }
            });
        }
    } catch (error) {
        // Silently fail on Redis error and proceed to DB
        console.warn('Cache read error:', error);
    }

    try {
        // Determine strictness based on viewport size to prevent scraping/overload
        const latSpan = Math.abs(params.north - params.south);
        const lonSpan = Math.abs(params.east - params.west);

        // If Viewport is too large (e.g. whole country), force high clustering or reject high zoom queries that abuse headers
        if ((latSpan > 50 || lonSpan > 50) && params.zoom > 10) {
            return NextResponse.json(
                { error: 'Viewport too large for this zoom level' },
                { status: 400 }
            );
        }

        const { clause, values } = buildFilterClause(params);
        const filtersActive = hasNonDefaultFilters(params);

        // Determine query strategy based on zoom
        // Zoom 0-13: Clusters
        // Zoom 14+: Individual Properties
        let responseData;
        let clusterSource: 'mv' | 'live' = 'live';

        if (params.zoom < 14) {
            // Wave 2 fast-path: when the user has no filters active
            // (default for_sale browse), serve clusters from
            // mv_cluster_tiles instead of recomputing the centroid on
            // every cache miss. The MV is refreshed every 10 min by
            // the worker-refresh container.
            //
            // Filtered cluster queries fall through to the on-the-fly
            // path — pre-baking every filter combination would blow up
            // the MV row count.
            if (!filtersActive) {
                const mvQuery = `
                  SELECT
                    latitude,
                    longitude,
                    count,
                    avg_price,
                    min_price,
                    max_price
                  FROM mv_cluster_tiles
                  WHERE zoom = $1
                    AND geom && ST_MakeEnvelope($2, $3, $4, $5, 4326)
                `;
                const res = await withSpan(
                    'viewport.mv_cluster_tiles',
                    () =>
                        pool.query(mvQuery, [
                            params.zoom,
                            params.west, params.south, params.east, params.north,
                        ]),
                    { 'db.zoom': params.zoom, 'cluster.source': 'mv' },
                );
                clusterSource = 'mv';
                responseData = {
                    type: 'clusters',
                    data: res.rows,
                    zoom: params.zoom,
                };
            } else {
                // Original on-the-fly clustering path for filtered queries.
                // eps mirrors mv_cluster_tiles' grid math: 30 / 2^zoom.
                const eps = 30 / Math.pow(2, params.zoom);

                const query = `
        SELECT
          ST_Y(ST_Centroid(ST_Collect(geom))) as latitude,
          ST_X(ST_Centroid(ST_Collect(geom))) as longitude,
          COUNT(*) as count,
          AVG(price)::numeric(10,0) as avg_price,
          MIN(price) as min_price,
          MAX(price) as max_price
        FROM listings
        WHERE
          geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
          ${clause}
        GROUP BY ST_SnapToGrid(geom, $${values.length + 5})
      `;

                const res = await withSpan(
                    'viewport.live_cluster',
                    () =>
                        pool.query(query, [
                            params.west, params.south, params.east, params.north,
                            ...values,
                            eps
                        ]),
                    { 'db.zoom': params.zoom, 'cluster.source': 'live' },
                );

                responseData = {
                    type: 'clusters',
                    data: res.rows,
                    zoom: params.zoom
                };
            }

        } else {
            // Individual Properties Query (High Zoom)
            // Limit to 2000 to prevent browser crash
            const query = `
        SELECT
          id,
          address,
          price,
          bedrooms,
          bathrooms,
          sqft,
          primary_photo,
          listing_type as status,
          ST_Y(geom) as latitude,
          ST_X(geom) as longitude
        FROM listings
        WHERE
          geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
          ${clause}
        LIMIT 2000
      `;

            const res = await withSpan(
                'viewport.properties',
                () =>
                    pool.query(query, [
                        params.west, params.south, params.east, params.north,
                        ...values
                    ]),
                { 'db.zoom': params.zoom },
            );

            responseData = {
                type: 'properties',
                data: res.rows,
                zoom: params.zoom
            };
        }

        const finalResponse = {
            ...responseData,
            meta: {
                time: Date.now() - startTime,
                count: responseData.data.length,
                cluster_source: params.zoom < 14 ? clusterSource : undefined
            }
        };

        // Cache the result
        try {
            await redis.setex(cacheKey, 60, JSON.stringify(finalResponse));
        } catch (error) {
            console.warn('Cache write error:', error);
        }

        return NextResponse.json(finalResponse, {
            headers: {
                'X-Cache': 'MISS',
                'Cache-Control': 'public, max-age=60, s-maxage=300'
            }
        });

    } catch (error) {
        console.error('API Error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

// Wave 2: the MV fast-path can only serve queries that match its
// baked-in WHERE (listing_type='for_sale' AND geom IS NOT NULL). Any
// user-supplied filter — price, beds, baths, propertyType, or a non-
// default status — disqualifies the request and we fall through to
// the on-the-fly clustering query.
function hasNonDefaultFilters(params: ViewportParams): boolean {
    if (params.minPrice !== undefined) return true;
    if (params.maxPrice !== undefined) return true;
    if (params.beds !== undefined) return true;
    if (params.baths !== undefined) return true;
    if (params.propertyType !== undefined && params.propertyType !== '') return true;
    if (params.status !== undefined && params.status !== 'for_sale') return true;
    return false;
}

function buildFilterClause(params: ViewportParams) {
    const parts = [];
    const values = [];
    let idx = 5; // Start after bbox params ($1-$4)

    if (params.minPrice) {
        parts.push(`price >= $${idx++}`);
        values.push(params.minPrice);
    }

    if (params.maxPrice) {
        parts.push(`price <= $${idx++}`);
        values.push(params.maxPrice);
    }

    if (params.beds) {
        parts.push(`bedrooms >= $${idx++}`);
        values.push(params.beds);
    }

    if (params.baths) {
        parts.push(`bathrooms >= $${idx++}`);
        values.push(params.baths);
    }

    if (params.status) {
        parts.push(`listing_type = $${idx++}`);
        values.push(params.status);
    } else {
        // Default to 'for_sale' if not specified
        parts.push(`listing_type = 'for_sale'`);
    }

    return {
        clause: parts.length > 0 ? 'AND ' + parts.join(' AND ') : '',
        values
    };
}
