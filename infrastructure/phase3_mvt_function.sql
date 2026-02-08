-- Function to generate Vector Tiles for listings with filtering
-- Accepts Z, X, Y tile coordinates and filter parameters via pg_tileserv
DROP FUNCTION IF EXISTS public.listings_mvt;
CREATE OR REPLACE FUNCTION public.listings_mvt(
        z integer,
        x integer,
        y integer,
        min_price numeric DEFAULT 0,
        max_price numeric DEFAULT 999999999,
        min_beds numeric DEFAULT 0,
        min_baths numeric DEFAULT 0,
        listing_status text DEFAULT 'for_sale'
    ) RETURNS bytea AS $$
DECLARE mvt bytea;
BEGIN
SELECT INTO mvt ST_AsMVT(tile, 'listings', 4096, 'geom')
FROM (
        SELECT id,
            price,
            bedrooms,
            bathrooms,
            sqft,
            listing_type,
            ST_AsMVTGeom(geom, ST_TileEnvelope(z, x, y)) AS geom
        FROM listings
        WHERE geom && ST_TileEnvelope(z, x, y)
            AND price >= min_price
            AND price <= max_price
            AND bedrooms >= min_beds
            AND bathrooms >= min_baths -- Simple status filter (partial match or exact)
            -- If status is 'any', ignore. Else match.
            AND (
                listing_status = 'any'
                OR listing_type = listing_status
            )
    ) AS tile;
RETURN mvt;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;