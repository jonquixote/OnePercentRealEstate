-- Fix history seed: the original seed (2026_07_05_listings_history_trigger)
-- used created_at as observed_at, backdating current state to listing
-- creation time. Delete those rows and re-insert with the correct NOW()
-- timestamp. Trigger observations (which use NOW()) are unaffected — the
-- DELETE only matches rows where observed_at == created_at, which is never
-- true for trigger-written rows.

BEGIN;

-- Remove seed rows: observed_at was set equal to listing's created_at.
DELETE FROM listings_history h
USING listings l
WHERE h.listing_id = l.id
  AND h.observed_at = l.created_at;

-- Re-seed with the correct timestamp (migration run time).
INSERT INTO listings_history (listing_id, observed_at, price, estimated_rent, days_on_market, listing_status)
SELECT id, NOW(), price, estimated_rent, days_on_market, listing_status
FROM listings
WHERE price IS NOT NULL
ON CONFLICT (listing_id, observed_at) DO NOTHING;

COMMIT;
