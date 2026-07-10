-- Wave 11: Walk Score API cache (page display only).
--
-- Walk Score free tier allows 5,000 calls/day. We cache scores server-side
-- with a 30-day TTL so repeat property page views don't burn API quota.
-- Scores are display-only; no business logic depends on them.

BEGIN;

CREATE TABLE IF NOT EXISTS walkscore_cache (
  addr_norm TEXT PRIMARY KEY,
  walk INT,
  transit INT,
  bike INT,
  ws_link TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_walkscore_cache_fetched
  ON walkscore_cache (fetched_at DESC);

COMMENT ON TABLE walkscore_cache IS
  'Cache of Walk Score API results (walk, transit, bike scores + permalink). 30-day TTL enforced at query time.';
COMMENT ON COLUMN walkscore_cache.addr_norm IS
  'Normalized address used as cache key — lowercase, single spaces, trimmed.';
COMMENT ON COLUMN walkscore_cache.ws_link IS
  'Walk Score permalink for the address (used for Walk Score® branding/link).';

COMMIT;