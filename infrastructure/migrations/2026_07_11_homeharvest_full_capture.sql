-- HomeHarvest full capture: stop throwing fields away.
-- Adds JSONB columns for nearby_schools, agent_info, tax_history on listings.
-- Adds stories (REAL) on listings.
-- Adds county_fips, neighborhoods, nearby_schools on rental_listings.
-- Adds source column with default + index on rental_listings.

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS nearby_schools JSONB,
  ADD COLUMN IF NOT EXISTS agent_info     JSONB,
  ADD COLUMN IF NOT EXISTS tax_history    JSONB,
  ADD COLUMN IF NOT EXISTS stories        REAL;

ALTER TABLE rental_listings
  ADD COLUMN IF NOT EXISTS county_fips    TEXT,
  ADD COLUMN IF NOT EXISTS neighborhoods  TEXT,
  ADD COLUMN IF NOT EXISTS nearby_schools JSONB,
  ADD COLUMN IF NOT EXISTS source         TEXT NOT NULL DEFAULT 'homeharvest';
CREATE INDEX IF NOT EXISTS idx_rental_listings_source ON rental_listings (source);
