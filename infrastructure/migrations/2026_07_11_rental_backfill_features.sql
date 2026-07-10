-- M2: Precompute flood_sfha and transit_stops_1km on rental_listings
-- These columns are computed per-row at training time via SQL (lateral flood_zone_at
-- is too slow for 350K rows). Precompute both and backfill in keyset batches.

ALTER TABLE rental_listings
  ADD COLUMN IF NOT EXISTS flood_sfha BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS transit_stops_1km INT DEFAULT 0;

-- ──────────────────────────────────────────────────────────────
-- Keyset backfills (run out-of-band, NOT in a transaction migration)
-- Each runs in batches of 10K rows; re-run until 0 rows affected.
-- ──────────────────────────────────────────────────────────────

-- Backfill flood_sfha for geocoded rows in loaded states
-- UPDATE rental_listings l
-- SET flood_sfha = EXISTS(
--   SELECT 1 FROM flood_zones f
--   WHERE f.sfha AND ST_Contains(f.geom, ST_SetSRID(ST_MakePoint(l.longitude, l.latitude), 4326))
-- )
-- WHERE l.latitude IS NOT NULL AND l.longitude IS NOT NULL
--   AND l.flood_sfha = FALSE
--   AND l.id IN (SELECT id FROM rental_listings WHERE latitude IS NOT NULL ORDER BY id LIMIT 10000);

-- Backfill transit_stops_1km for geocoded rows
-- UPDATE rental_listings l
-- SET transit_stops_1km = (
--   SELECT COUNT(*) FROM transit_stops t
--   WHERE ST_DWithin(t.geom::geography, ST_SetSRID(ST_MakePoint(l.longitude, l.latitude), 4326)::geography, 1000)
-- )
-- WHERE l.latitude IS NOT NULL AND l.longitude IS NOT NULL
--   AND l.transit_stops_1km = 0
--   AND l.id IN (SELECT id FROM rental_listings WHERE latitude IS NOT NULL ORDER BY id LIMIT 10000);
