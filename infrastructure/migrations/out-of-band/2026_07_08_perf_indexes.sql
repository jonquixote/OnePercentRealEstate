-- Add missing DB indexes for performance
--
-- Out-of-band: CREATE INDEX CONCURRENTLY cannot run inside a transaction,
-- and the migration runner wraps every file in BEGIN/COMMIT. Run by hand
-- statement-by-statement via psql.
-- Applied on prod 2026-07-08 (verified via pg_indexes).

-- index on listings.census_tract for JOIN with census_tracts
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_census_tract ON listings(census_tract) WHERE census_tract IS NOT NULL;

-- GiST index on rental_listings.location for ST_Distance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rental_location_gist ON rental_listings USING GIST(location);

-- index on census_tracts.nri_overall_score for ORDER BY + WHERE
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tracts_nri_score ON census_tracts(nri_overall_score DESC NULLS LAST);

-- composite index for common filter pattern on market page
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_zip_type_sale ON listings(zip_code, listing_type, sale_type) WHERE price > 10000;
