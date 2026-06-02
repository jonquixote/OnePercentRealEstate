-- 2026_06_04_listings_history.sql
-- Wave 1: rollup table for price/DOM history so Wave 6 sparklines have
-- something to chart. The scraper writes one row per refresh.
--
-- Kept narrow on purpose — only the fields the inline sparkline reads.

CREATE TABLE IF NOT EXISTS listings_history (
  listing_id BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  price NUMERIC(12,2),
  estimated_rent NUMERIC(10,2),
  days_on_market INTEGER,
  listing_status TEXT,
  PRIMARY KEY (listing_id, observed_at)
);

-- common read pattern: load the last N points for one listing
CREATE INDEX IF NOT EXISTS idx_listings_history_listing_recent
  ON listings_history (listing_id, observed_at DESC);
