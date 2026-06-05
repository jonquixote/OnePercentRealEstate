-- Wave 7: Mapbox geocoding cache + rate-limit resilience.
--
-- The scraper calls Mapbox geocoding API (10 req/sec ceiling). To avoid
-- hammering the API on retries and to survive transient outages, cache
-- all lookups (successful or miss) permanently. Misses expire after 7d
-- so a transient outage doesn't poison the cache forever.
--
-- query_hash is sha256(lowercased query) for efficient deduplication.
-- attempts tracks how many times this query was seen before the first
-- successful resolution — useful for drift audit if we're re-geocoding
-- properties that landed in cache long ago.

BEGIN;

CREATE TABLE IF NOT EXISTS geocode_cache (
  query_hash TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  provider TEXT NOT NULL DEFAULT 'mapbox',
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  miss BOOLEAN NOT NULL DEFAULT false,
  attempts INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_geocode_cache_resolved
  ON geocode_cache (resolved_at DESC);

CREATE INDEX IF NOT EXISTS idx_geocode_cache_expires
  ON geocode_cache (expires_at)
  WHERE miss = true AND expires_at IS NOT NULL;

COMMENT ON TABLE geocode_cache IS
  'Permanent cache of Mapbox geocoding results. Successful lookups have no expiry; misses expire after 7d.';
COMMENT ON COLUMN geocode_cache.query_hash IS
  'sha256(lowercased query) — primary key for deduplication.';
COMMENT ON COLUMN geocode_cache.miss IS
  'true if Mapbox returned HTTP 4xx or network error; false if (lat,lon) are valid.';

COMMIT;
