-- 2026_07_02_mvt_filter_params.sql
-- Add filter parameters (price, beds, baths, property_type) to listings_mvt
-- function, all 3 branches. pg_tileserv forwards query params matching the
-- function args, so ?p_min_price=100000&p_max_price=500000&p_min_beds=3 etc.
-- will work out of the box (just restart pg_tileserv after applying).
--
-- DROP + CREATE because arg count changes.

BEGIN;

DROP FUNCTION IF EXISTS public.listings_mvt(integer, integer, integer, text, boolean, text);

CREATE OR REPLACE FUNCTION public.listings_mvt(
    z integer, x integer, y integer,
    p_listing_status text DEFAULT 'for_sale',
    one_pct_only boolean DEFAULT false,
    p_sale_type text DEFAULT 'standard',
    p_min_price numeric DEFAULT NULL,
    p_max_price numeric DEFAULT NULL,
    p_min_beds integer DEFAULT NULL,
    p_min_baths numeric DEFAULT NULL,
    p_property_type text DEFAULT NULL
)
RETURNS bytea
LANGUAGE plpgsql
STABLE PARALLEL SAFE
AS $function$
DECLARE
    result bytea;
    bounds geometry;
    bounds4326 geometry;
    grid_size float8;
    filter_extra text;
BEGIN
    bounds     := ST_TileEnvelope(z, x, y);
    bounds4326 := ST_Transform(bounds, 4326);

    IF z <= 7 AND p_listing_status = 'for_sale' AND p_sale_type = 'standard'
       AND p_min_price IS NULL AND p_max_price IS NULL
       AND p_min_beds IS NULL AND p_min_baths IS NULL
       AND p_property_type IS NULL THEN
        -- LOW ZOOM, standard view: pre-computed MV (standard-only) — fast path.
        -- Note: MV does not support dynamic per-request filters; the MV is used
        -- as-is. This is acceptable since zoomed-out tiles are small and the
        -- filters mainly matter at high zoom.
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
                ST_AsMVTGeom(ST_Transform(geom, 3857), bounds, 4096, 256, true) AS geom
            FROM mv_cluster_tiles
            WHERE zoom = z
              AND ST_Intersects(geom, bounds4326)
              AND (NOT one_pct_only OR (
                  avg_price > 0 AND avg_rent > 0
                  AND (avg_rent::numeric / avg_price) >= 0.01
              ))
        ) AS tile
        WHERE geom IS NOT NULL;

    ELSIF z <= 7 THEN
        -- LOW ZOOM, other statuses / distress views: snap to grid on-the-fly.
        grid_size := 180.0 / (2.0 ^ z * 4.0);

        SELECT ST_AsMVT(tile, 'listings', 4096, 'geom') INTO result
        FROM (
            SELECT
                count(*)::int AS count,
                ROUND(avg(
                    CASE WHEN price > 0 AND estimated_rent > 0
                         THEN (estimated_rent::numeric / price) * 100
                         ELSE NULL END
                )::numeric, 2)::double precision AS ratio_pct,
                ST_AsMVTGeom(ST_Transform(ST_Centroid(ST_Collect(geom)), 3857), bounds, 4096, 256, true) AS geom
            FROM (
                SELECT l.price, l.estimated_rent, l.geom,
                       ST_SnapToGrid(l.geom, grid_size) AS grid_cell
                FROM listings l
                WHERE l.listing_type = p_listing_status
                  AND l.sale_type = p_sale_type
                  AND l.geom IS NOT NULL
                  AND ST_Intersects(l.geom, bounds4326)
                  AND public.is_rentable(l.property_type)
                  AND (NOT one_pct_only OR (
                      l.rent_calc_status = 'done'
                      AND l.price > 0 AND l.estimated_rent > 0
                      AND (l.estimated_rent::numeric / l.price) >= 0.01
                  ))
                  AND (p_min_price IS NULL OR l.price >= p_min_price)
                  AND (p_max_price IS NULL OR l.price <= p_max_price)
                  AND (p_min_beds IS NULL OR l.bedrooms >= p_min_beds)
                  AND (p_min_baths IS NULL OR l.bathrooms >= p_min_baths)
                  AND (p_property_type IS NULL OR l.property_type = p_property_type)
            ) sub
            GROUP BY grid_cell
        ) AS tile
        WHERE geom IS NOT NULL;

    ELSE
        -- HIGH ZOOM: individual points, capped at 2000 per tile.
        SELECT ST_AsMVT(tile, 'listings', 4096, 'geom') INTO result
        FROM (
            SELECT
                l.id, l.price, l.estimated_rent, l.address, l.city, l.state,
                l.property_type, l.bedrooms, l.bathrooms, l.sqft,
                (CASE WHEN l.price > 0 AND l.estimated_rent > 0
                     THEN ROUND((l.estimated_rent::numeric / l.price) * 100, 2)
                     ELSE 0 END)::double precision AS ratio_pct,
                l.primary_photo,
                ST_AsMVTGeom(ST_Transform(l.geom, 3857), bounds, 4096, 256, true) AS geom
            FROM listings l
            WHERE l.listing_type = p_listing_status
              AND l.sale_type = p_sale_type
              AND l.geom IS NOT NULL
              AND ST_Intersects(l.geom, bounds4326)
              AND public.is_rentable(l.property_type)
              AND (NOT one_pct_only OR (
                  l.rent_calc_status = 'done'
                  AND l.price > 0 AND l.estimated_rent > 0
                  AND (l.estimated_rent::numeric / l.price) >= 0.01
              ))
              AND (p_min_price IS NULL OR l.price >= p_min_price)
              AND (p_max_price IS NULL OR l.price <= p_max_price)
              AND (p_min_beds IS NULL OR l.bedrooms >= p_min_beds)
              AND (p_min_baths IS NULL OR l.bathrooms >= p_min_baths)
              AND (p_property_type IS NULL OR l.property_type = p_property_type)
            LIMIT 2000
        ) AS tile
        WHERE geom IS NOT NULL;

    END IF;

    RETURN COALESCE(result, '');
END;
$function$;

COMMIT;
