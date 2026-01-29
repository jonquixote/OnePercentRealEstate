-- Enhanced Rental Schema for ML Training
-- Run this migration to add columns needed for the Pinnacle Rent Estimator

-- Add new columns for richer ML features
ALTER TABLE rental_listings ADD COLUMN IF NOT EXISTS year_built INT;
ALTER TABLE rental_listings ADD COLUMN IF NOT EXISTS lot_sqft NUMERIC;
ALTER TABLE rental_listings ADD COLUMN IF NOT EXISTS hoa_fee NUMERIC;
ALTER TABLE rental_listings ADD COLUMN IF NOT EXISTS days_on_market INT;
ALTER TABLE rental_listings ADD COLUMN IF NOT EXISTS parking_garage BOOLEAN DEFAULT FALSE;
ALTER TABLE rental_listings ADD COLUMN IF NOT EXISTS has_ac BOOLEAN;
ALTER TABLE rental_listings ADD COLUMN IF NOT EXISTS has_pool BOOLEAN;
ALTER TABLE rental_listings ADD COLUMN IF NOT EXISTS pet_friendly BOOLEAN;

-- Track price history for trend analysis
ALTER TABLE rental_listings ADD COLUMN IF NOT EXISTS original_price NUMERIC;
ALTER TABLE rental_listings ADD COLUMN IF NOT EXISTS price_reduced BOOLEAN DEFAULT FALSE;

-- Improve uniqueness constraint to allow historical tracking
-- Drop old constraint if exists and create new one
ALTER TABLE rental_listings DROP CONSTRAINT IF EXISTS rental_listings_address_listing_date_key;

-- Create composite unique on address + source + listing_date for better historical tracking
CREATE UNIQUE INDEX IF NOT EXISTS idx_rental_unique_listing 
ON rental_listings(address, source, listing_date);

-- Index for ML training queries
CREATE INDEX IF NOT EXISTS idx_rental_geo ON rental_listings(latitude, longitude) 
WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rental_created ON rental_listings(created_at DESC);

-- Enable PostGIS if available (for spatial queries)
CREATE EXTENSION IF NOT EXISTS postgis;

-- Add geography column for efficient distance calculations
ALTER TABLE rental_listings ADD COLUMN IF NOT EXISTS location GEOGRAPHY(POINT, 4326);

-- Populate geography column from lat/lon
UPDATE rental_listings 
SET location = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND location IS NULL;

-- Trigger to auto-populate location on insert/update
CREATE OR REPLACE FUNCTION update_rental_location()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
        NEW.location := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_rental_location ON rental_listings;
CREATE TRIGGER trg_update_rental_location
    BEFORE INSERT OR UPDATE ON rental_listings
    FOR EACH ROW
    EXECUTE FUNCTION update_rental_location();

-- Stats view for monitoring data quality
CREATE OR REPLACE VIEW rental_data_stats AS
SELECT 
    COUNT(*) as total_listings,
    COUNT(DISTINCT zip_code) as unique_zips,
    COUNT(DISTINCT city || ', ' || state) as unique_markets,
    AVG(price) as avg_rent,
    MIN(created_at) as oldest_listing,
    MAX(created_at) as newest_listing,
    SUM(CASE WHEN sqft IS NOT NULL THEN 1 ELSE 0 END)::float / COUNT(*) * 100 as pct_with_sqft,
    SUM(CASE WHEN year_built IS NOT NULL THEN 1 ELSE 0 END)::float / COUNT(*) * 100 as pct_with_year_built
FROM rental_listings;
