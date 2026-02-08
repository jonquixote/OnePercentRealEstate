-- Phase 1: Geometry Migration Script
-- Run this to add PostGIS geometry support to listings table
-- ==============================================
-- STEP 1: Create Backup (Safety)
-- ==============================================
CREATE SCHEMA IF NOT EXISTS backup_20260207;
-- Only run this if you want a full backup (takes time with 1.25M rows)
-- CREATE TABLE backup_20260207.listings AS SELECT * FROM listings;
-- ==============================================
-- STEP 2: Add Geometry Column
-- ==============================================
ALTER TABLE listings
ADD COLUMN IF NOT EXISTS geom geometry(Point, 4326);
COMMENT ON COLUMN listings.geom IS 'PostGIS geometry column (SRID 4326 - WGS84). Auto-populated via trigger.';
-- ==============================================
-- STEP 3: Create Auto-Population Trigger
-- This must be created BEFORE the migration so new listings during migration get geom
-- ==============================================
CREATE OR REPLACE FUNCTION populate_geom() RETURNS TRIGGER AS $$ BEGIN -- Auto-populate geometry from lat/lng if available
    IF NEW.longitude IS NOT NULL
    AND NEW.latitude IS NOT NULL THEN NEW.geom := ST_SetSRID(
        ST_MakePoint(NEW.longitude::float, NEW.latitude::float),
        4326
    );
END IF;
RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS trigger_populate_geom ON listings;
CREATE TRIGGER trigger_populate_geom BEFORE
INSERT
    OR
UPDATE OF longitude,
    latitude ON listings FOR EACH ROW EXECUTE FUNCTION populate_geom();
-- ==============================================
-- STEP 4: Batched Migration of Existing Data
-- Updates in batches of 50,000 to avoid long locks
-- ==============================================
DO $$
DECLARE batch_size INT := 50000;
total_rows BIGINT;
processed BIGINT := 0;
batch_count INT := 0;
start_time TIMESTAMP;
batch_start TIMESTAMP;
BEGIN -- Count rows needing migration
SELECT COUNT(*) INTO total_rows
FROM listings
WHERE longitude IS NOT NULL
    AND latitude IS NOT NULL
    AND geom IS NULL;
RAISE NOTICE 'Starting migration of % rows in batches of %',
total_rows,
batch_size;
start_time := clock_timestamp();
WHILE processed < total_rows LOOP batch_start := clock_timestamp();
batch_count := batch_count + 1;
-- Update one batch using ctid for efficient row selection
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
-- Get how many were actually updated
GET DIAGNOSTICS processed = ROW_COUNT;
RAISE NOTICE 'Batch %: Updated % rows (%.1f%%) in % seconds', batch_count, processed, (processed::FLOAT / NULLIF(total_rows, 0) * 100), EXTRACT(
    EPOCH
    FROM clock_timestamp() - batch_start
);
-- Brief pause to allow other queries to execute
PERFORM pg_sleep(0.2);
-- Recalculate remaining
SELECT COUNT(*) INTO total_rows
FROM listings
WHERE longitude IS NOT NULL
    AND latitude IS NOT NULL
    AND geom IS NULL;
IF total_rows = 0 THEN EXIT;
END IF;
END LOOP;
RAISE NOTICE 'Migration complete. Total time: %',
clock_timestamp() - start_time;
END $$;
-- ==============================================
-- STEP 5: Verify Migration
-- ==============================================
SELECT COUNT(*) as total,
    COUNT(geom) as with_geometry,
    COUNT(*) - COUNT(geom) as missing_geometry,
    ROUND(
        COUNT(geom)::numeric / NULLIF(COUNT(*), 0)::numeric * 100,
        2
    ) as geometry_coverage_pct
FROM listings
WHERE latitude IS NOT NULL
    AND longitude IS NOT NULL;
-- ==============================================
-- STEP 6: Create Spatial Indexes
-- ==============================================
-- Primary spatial index
CREATE INDEX IF NOT EXISTS idx_listings_geom ON listings USING GIST(geom);
-- Index on active listings with geometry (common query pattern)
CREATE INDEX IF NOT EXISTS idx_listings_geom_type ON listings USING GIST(geom)
WHERE listing_type = 'for_sale'
    AND geom IS NOT NULL;
-- Update statistics for query planner
ANALYZE listings;
-- ==============================================
-- STEP 7: Verify Indexes
-- ==============================================
SELECT indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'listings'
    AND indexname LIKE '%geom%'
ORDER BY indexname;
-- ==============================================
-- STEP 8: Create Geometry Health View
-- ==============================================
CREATE OR REPLACE VIEW listing_geom_health AS
SELECT COUNT(*) as total_listings,
    COUNT(geom) as with_geometry,
    COUNT(*) - COUNT(geom) as missing_geometry,
    ROUND(
        COUNT(geom)::numeric / NULLIF(COUNT(*), 0)::numeric * 100,
        2
    ) as geometry_coverage_pct,
    MAX(created_at) as latest_listing_added,
    COUNT(*) FILTER (
        WHERE created_at > NOW() - INTERVAL '24 hours'
    ) as added_last_24h
FROM listings;
-- Check health
SELECT *
FROM listing_geom_health;