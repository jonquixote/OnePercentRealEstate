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
-- CONCURRENTLY cannot run inside a transaction, so run by hand against prod,
-- off-peak:
--   psql "$DATABASE_URL" -f 2026_07_21_tighten_spotlight_index.sql
DROP INDEX CONCURRENTLY IF EXISTS idx_listings_spotlight;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_spotlight
    ON listings (rent_price_ratio DESC, created_at DESC)
    WHERE listing_type = 'for_sale'
      AND price >= 30000
      AND estimated_rent > 0
      AND rent_price_ratio >= 0.01
      AND rent_price_ratio <= 0.02
      AND geom IS NOT NULL
      AND COALESCE(primary_photo, images->>0) IS NOT NULL;
