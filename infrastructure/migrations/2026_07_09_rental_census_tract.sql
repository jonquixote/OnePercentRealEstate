-- rental_listings.census_tract — the serving/training join key for the
-- hyperlocal tract features (rent model v2 P1). Column + partial index only;
-- the backfill itself is out-of-band (CONCURRENTLY-free but long-running).
ALTER TABLE rental_listings ADD COLUMN IF NOT EXISTS census_tract TEXT;
CREATE INDEX IF NOT EXISTS idx_rental_census_tract
  ON rental_listings(census_tract) WHERE census_tract IS NOT NULL;
