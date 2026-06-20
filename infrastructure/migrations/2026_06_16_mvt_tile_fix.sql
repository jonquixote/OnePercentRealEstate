-- Migration: Fix MVT tile function for pg_tileserv
-- Replaces the existing listings_mvt function with a corrected version that:
-- 1. Includes estimated_rent, address, property_type in tile payload
-- 2. Filters out non-rentable property types
-- 3. Uses STABLE volatility (not IMMUTABLE, since it reads table data)
-- 4. Adds optional 1%-only filter flag
-- 5. Includes ratio_pct for frontend color-coding

DROP FUNCTION IF EXISTS public.listings_mvt(integer,integer,integer,text,boolean);

CREATE OR REPLACE FUNCTION public.listings_mvt(
    z integer, x integer, y integer,
    p_listing_status text DEFAULT 'for_sale',
    one_pct_only boolean DEFAULT false
)
RETURNS bytea
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
AS $$
DECLARE
    result bytea;
    bounds geometry;
BEGIN
    bounds := ST_TileEnvelope(z, x, y);

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
            CASE WHEN l.price > 0 AND l.estimated_rent > 0
                 THEN ROUND((l.estimated_rent::numeric / l.price) * 100, 2)
                 ELSE 0
            END AS ratio_pct,
            l.primary_photo,
            ST_AsMVTGeom(
                ST_Transform(l.geom, 3857),
                bounds,
                4096, 256, true
            ) AS geom
        FROM listings l
        WHERE l.listing_type = p_listing_status
          AND l.geom IS NOT NULL
          AND ST_Intersects(l.geom, ST_Transform(bounds, 4326))
          AND public.is_rentable(l.property_type)
          AND (NOT one_pct_only OR (
              l.rent_calc_status = 'done'
              AND l.price > 0
              AND l.estimated_rent > 0
              AND (l.estimated_rent::numeric / l.price) >= 0.01
          ))
    ) AS tile;

    RETURN COALESCE(result, '');
END;
$$;

-- Comment for pg_tileserv auto-discovery
COMMENT ON FUNCTION public.listings_mvt IS 'Vector tiles of property listings with ratio data. Filters non-rentable types.';
