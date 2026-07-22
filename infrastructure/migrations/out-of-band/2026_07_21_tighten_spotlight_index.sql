-- Tightens the spotlight partial index to match the new plausibility ceiling
-- (rent_price_ratio <= 0.02, mirroring RENT_TRUST.maxRatio in
-- apps/one/src/lib/rent-trust.ts and used by apps/one/src/lib/spotlight.ts).
--
-- The previous partial index (infrastructure/migrations/out-of-band/
-- 2026_07_16_spotlight_index.sql) used <= 0.05; the planner would fall back
-- to a Parallel Seq Scan (~1.15s over 352k rows) once the spotlight WHERE
-- was tightened to <= 0.02 in code, because the index predicate would no longer
-- be a superset of the query's.
--
-- SAFETY ORDER:
--   1. Build a replacement index concurrently under a temporary name.
--   2. Drop the old idx_listings_spotlight concurrently.
--   3. Rename the replacement to the canonical name.
-- Building the replacement first means a mid-build crash never leaves the
-- home page without a usable spotlight index — the old one stays live until
-- the new one is fully usable.
--
-- CONCURRENTLY cannot run inside a transaction, so run by hand against prod,
-- off-peak:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 2026_07_21_tighten_spotlight_index.sql
--   (errors abort cleanly; rerun is safe.)
--
-- If a previous attempt left an INVALID index behind, drop it first:
--   DROP INDEX CONCURRENTLY IF EXISTS idx_listings_spotlight;
--   DROP INDEX CONCURRENTLY IF EXISTS idx_listings_spotlight_new;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_spotlight_new
    ON listings (rent_price_ratio DESC, created_at DESC)
    WHERE listing_type = 'for_sale'
      AND price >= 30000
      AND estimated_rent > 0
      AND rent_price_ratio >= 0.01
      AND rent_price_ratio <= 0.02
      AND geom IS NOT NULL
      AND COALESCE(primary_photo, images->>0) IS NOT NULL;

DROP INDEX CONCURRENTLY IF EXISTS idx_listings_spotlight;

ALTER INDEX idx_listings_spotlight_new RENAME TO idx_listings_spotlight;
