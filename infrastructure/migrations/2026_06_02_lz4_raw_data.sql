-- 2026_06_02_lz4_raw_data.sql
-- Wave 1: switch raw_data column compression from default (pglz) to lz4.
--
-- Effect on NEW writes only — existing TOASTed values stay pglz until
-- rewritten by UPDATE, VACUUM FULL, or pg_repack. That's intentional:
-- the spike showed only ~5% size delta at current scale, so we don't
-- want to pay a full table rewrite for a marginal one-time win.
-- LZ4 gives us a faster decompression path on every read going forward,
-- which compounds as scale grows.
--
-- Idempotent (sets the attribute; safe to re-run).

ALTER TABLE listings ALTER COLUMN raw_data SET COMPRESSION lz4;

-- Same treatment for rental_listings.raw_data (same shape, same access pattern).
ALTER TABLE rental_listings ALTER COLUMN raw_data SET COMPRESSION lz4;
