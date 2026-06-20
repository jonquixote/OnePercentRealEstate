-- Fix MVT serialization: postgres numeric type maps to string/text in MVT tiles.
-- Cast ratio_pct calculations to double precision so Mapbox GL JS receives them as numbers.
-- Fix performance: query mv_cluster_tiles at z <= 7 for active listings to avoid timeouts under database load.

CREATE OR REPLACE FUNCTION public.listings_mvt(
    z integer,
    x integer,
    y integer,
    p_listing_status text DEFAULT 'for_sale',
    one_pct_only boolean DEFAULT false
)
RETURNS bytea
LANGUAGE plpgsql
STABLE PARALLEL SAFE
AS $$
DECLARE
    result bytea;
    bounds geometry;
    bounds4326 geometry;
    -- Grid cell size in degrees, larger at low zoom = fewer, bigger clusters
    grid_size float8;
BEGIN
    bounds     := ST_TileEnvelope(z, x, y);
    bounds4326 := ST_Transform(bounds, 4326);

    IF z <= 7 AND p_listing_status = 'for_sale' THEN
        -- ---------------------------------------------------------------
        -- LOW ZOOM (FOR SALE): use pre-computed materialized view clusters.
        -- Blazing fast (1000x speedup), avoids timeouts under load.
        -- ---------------------------------------------------------------
        SELECT ST_AsMVT(tile, 'listings', 4096, 'geom') INTO result
        FROM (
            SELECT
                count::int,
                ROUND(
                    CASE WHEN avg_price > 0 AND avg_rent > 0
                         THEN (avg_rent::numeric / avg_price) * 100
                         ELSE NULL END,
                    2
                )::double precision AS ratio_pct,
                ST_AsMVTGeom(
                    ST_Transform(geom, 3857),
                    bounds, 4096, 256, true
                ) AS geom
            FROM mv_cluster_tiles
            WHERE zoom = z
              AND ST_Intersects(geom, bounds4326)
              AND (NOT one_pct_only OR (
                  avg_price > 0
                  AND avg_rent > 0
                  AND (avg_rent::numeric / avg_price) >= 0.01
              ))
        ) AS tile
        WHERE geom IS NOT NULL;

    ELSIF z <= 7 THEN
        -- ---------------------------------------------------------------
        -- LOW ZOOM (OTHER STATUSES): snap to grid on-the-fly.
        -- ---------------------------------------------------------------
        grid_size := 180.0 / (2.0 ^ z * 4.0);

        SELECT ST_AsMVT(tile, 'listings', 4096, 'geom') INTO result
        FROM (
            SELECT
                count(*)::int                                       AS count,
                ROUND(avg(
                    CASE WHEN price > 0 AND estimated_rent > 0
                         THEN (estimated_rent::numeric / price) * 100
                         ELSE NULL END
                )::numeric, 2)::double precision                    AS ratio_pct,
                ST_AsMVTGeom(
                    ST_Transform(
                        ST_Centroid(
                            ST_Collect(geom)
                        ),
                        3857
                    ),
                    bounds, 4096, 256, true
                )                                                   AS geom
            FROM (
                SELECT
                    l.price,
                    l.estimated_rent,
                    l.geom,
                    -- snap each point to a grid cell centre
                    ST_SnapToGrid(l.geom, grid_size) AS grid_cell
                FROM listings l
                WHERE l.listing_type = p_listing_status
                  AND l.geom IS NOT NULL
                  AND ST_Intersects(l.geom, bounds4326)
                  AND public.is_rentable(l.property_type)
                  AND (NOT one_pct_only OR (
                      l.rent_calc_status = 'done'
                      AND l.price > 0
                      AND l.estimated_rent > 0
                      AND (l.estimated_rent::numeric / l.price) >= 0.01
                  ))
            ) sub
            GROUP BY grid_cell
        ) AS tile
        WHERE geom IS NOT NULL;

    ELSE
        -- ---------------------------------------------------------------
        -- HIGH ZOOM: return individual points, capped at 2000 per tile.
        -- ---------------------------------------------------------------
        SELECT ST_AsMVT(tile, 'listings', 4096, 'geom') INTO result
        FROM (
            SELECT
                l.id,
                l.price,
                l.estimated_rent,
                l.address,
                l.city,
                l.state,
                l.property_type,
                l.bedrooms,
                l.bathrooms,
                l.sqft,
                (CASE WHEN l.price > 0 AND l.estimated_rent > 0
                     THEN ROUND((l.estimated_rent::numeric / l.price) * 100, 2)
                     ELSE 0
                END)::double precision AS ratio_pct,
                l.primary_photo,
                ST_AsMVTGeom(
                    ST_Transform(l.geom, 3857),
                    bounds, 4096, 256, true
                ) AS geom
            FROM listings l
            WHERE l.listing_type = p_listing_status
              AND l.geom IS NOT NULL
              AND ST_Intersects(l.geom, bounds4326)
              AND public.is_rentable(l.property_type)
              AND (NOT one_pct_only OR (
                  l.rent_calc_status = 'done'
                  AND l.price > 0
                  AND l.estimated_rent > 0
                  AND (l.estimated_rent::numeric / l.price) >= 0.01
              ))
            LIMIT 2000
        ) AS tile
        WHERE geom IS NOT NULL;

    END IF;

    RETURN COALESCE(result, '');
END;
$$;

COMMENT ON FUNCTION public.listings_mvt IS 'Vector tiles: pre-computed mv_cluster_tiles at z<=7 for active listings, individual points at z>7. Filters non-rentable types and casts ratio_pct to float.';
