-- 'status' was 'watch' for 100% of rows (scraper constant, never a real signal).
-- listing_status carries actual state. Drop after the scraper stops writing it.
ALTER TABLE listings DROP COLUMN IF EXISTS status;
