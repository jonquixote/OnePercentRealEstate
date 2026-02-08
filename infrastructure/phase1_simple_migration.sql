-- Simplified migration script to run via nohup
-- Run this in the background on the server
DO $$
DECLARE batch_size INT := 100000;
-- Larger batches since no interactive session
total_rows BIGINT;
batch_count INT := 0;
BEGIN
SELECT COUNT(*) INTO total_rows
FROM listings
WHERE longitude IS NOT NULL
    AND latitude IS NOT NULL
    AND geom IS NULL;
RAISE NOTICE 'Starting migration of % rows in batches of %',
total_rows,
batch_size;
WHILE batch_count < 50 LOOP -- Max 50 batches = 5M rows
UPDATE listings
SET geom = ST_SetSRID(
        ST_MakePoint(longitude::float, latitude::float),
        4326
    )
WHERE id IN (
        SELECT id
        FROM listings
        WHERE geom IS NULL
            AND longitude IS NOT NULL
            AND latitude IS NOT NULL
        LIMIT batch_size
    );
GET DIAGNOSTICS batch_count = ROW_COUNT;
IF batch_count = 0 THEN RAISE NOTICE 'Migration complete!';
EXIT;
END IF;
batch_count := batch_count + 1;
RAISE NOTICE 'Batch % complete',
batch_count;
END LOOP;
END $$;
-- Create indexes after migration
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
SELECT *
FROM listing_geom_health;