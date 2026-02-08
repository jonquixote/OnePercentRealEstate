-- Fixed migration script - runs as single efficient bulk UPDATE
-- This is faster than looping for large datasets
-- First, run the bulk update directly (no DO block issues)
UPDATE listings
SET geom = ST_SetSRID(
        ST_MakePoint(longitude::float, latitude::float),
        4326
    )
WHERE geom IS NULL
    AND longitude IS NOT NULL
    AND latitude IS NOT NULL;
-- Create GIST indexes
CREATE INDEX IF NOT EXISTS idx_listings_geom ON listings USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_listings_geom_type ON listings USING GIST(geom)
WHERE listing_type = 'for_sale'
    AND geom IS NOT NULL;
-- Update stats
ANALYZE listings;
-- Create health view
CREATE OR REPLACE VIEW listing_geom_health AS
SELECT COUNT(*) as total_listings,
    COUNT(geom) as with_geometry,
    COUNT(*) - COUNT(geom) as missing_geometry,
    ROUND(
        COUNT(geom)::numeric / NULLIF(COUNT(*), 0)::numeric * 100,
        2
    ) as geometry_coverage_pct
FROM listings;
-- Show results
SELECT *
FROM listing_geom_health;
SELECT indexname
FROM pg_indexes
WHERE tablename = 'listings'
    AND indexname LIKE '%geom%';