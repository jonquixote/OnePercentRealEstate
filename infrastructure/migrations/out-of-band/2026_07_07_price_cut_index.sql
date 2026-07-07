-- OUT-OF-BAND (CONCURRENTLY cannot run in the runner's transaction).
-- Run: docker exec -i infrastructure-postgres-1 psql -U postgres < thisfile
-- Partial index for the "biggest cut" sort + hasPriceCut filter: only rows
-- with an actual cut are indexed, so it stays tiny relative to listings.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_price_cut
  ON listings (price_cut_pct DESC)
  WHERE price_cut_pct > 0 AND listing_type = 'for_sale';
