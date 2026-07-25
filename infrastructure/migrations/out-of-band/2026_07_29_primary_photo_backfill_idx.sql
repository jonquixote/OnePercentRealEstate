-- Lets the photo backfill locate remaining work in O(index) instead of
-- re-scanning 1.3M rows on every batch. Partial: only rows still needing a
-- fill are of interest, so the index shrinks toward nothing as the backfill
-- completes and costs almost no maintenance afterwards.
--
-- OUT OF BAND: CREATE INDEX CONCURRENTLY cannot run inside a transaction, and
-- the migration runner wraps every file in a single BEGIN/COMMIT. Apply by
-- hand, same as 2026_06_21_create_unique_index_concurrently.sql.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_photo_backfill
  ON listings (id)
  WHERE primary_photo IS NULL;
