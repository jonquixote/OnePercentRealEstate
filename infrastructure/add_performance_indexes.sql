-- Performance indexes for listings table
-- Run this on the production database to speed up queries
-- Index for listing type filter (most common filter)
CREATE INDEX IF NOT EXISTS idx_listings_listing_type ON listings(listing_type);
-- Index for price range queries
CREATE INDEX IF NOT EXISTS idx_listings_price ON listings(price);
-- Index for geospatial queries (map clustering)
CREATE INDEX IF NOT EXISTS idx_listings_lat_lon ON listings(latitude, longitude);
-- Index for sorting by newest (created_at DESC is very common)
CREATE INDEX IF NOT EXISTS idx_listings_created_desc ON listings(created_at DESC);
-- Composite index for common query pattern: type + sort
CREATE INDEX IF NOT EXISTS idx_listings_type_created ON listings(listing_type, created_at DESC);
-- Index for bedrooms/bathrooms filtering
CREATE INDEX IF NOT EXISTS idx_listings_beds_baths ON listings(bedrooms, bathrooms);