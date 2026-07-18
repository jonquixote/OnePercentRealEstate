-- Lifecycle for listings + quarantine of rental misfiles.
-- NEVER deletes: misfiled rows are re-labeled and excluded by readers.

ALTER TABLE listings ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
-- Seed: best available proxy so the reaper doesn't mass-stale on day one.
UPDATE listings SET last_seen_at = updated_at WHERE last_seen_at IS NULL;

-- Normalize legacy status value, then constrain the vocabulary.
UPDATE listings SET listing_status = 'active' WHERE listing_status = 'watch' OR listing_status IS NULL;
-- NULL silently passes a CHECK (UNKNOWN) — lock the column down first.
ALTER TABLE listings ALTER COLUMN listing_status SET NOT NULL;
ALTER TABLE listings ALTER COLUMN listing_status SET DEFAULT 'active';
ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_lifecycle_chk;
ALTER TABLE listings ADD CONSTRAINT listings_lifecycle_chk
  CHECK (listing_status IN ('active','pending_verify','sold','stale','rental_misfiled'));

-- Quarantine: the URL is authoritative. 2,865 rows at authoring time.
-- property_url is a first-class column (verified 100% populated on prod) —
-- avoid deserializing raw_data JSONB across 1.1M rows.
UPDATE listings SET listing_status = 'rental_misfiled'
WHERE property_url LIKE '%/rentals/details/%';

-- Sold columns denormalized onto the listing when reconciled (Task 3).
ALTER TABLE listings ADD COLUMN IF NOT EXISTS sold_price numeric;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS sold_date date;

-- Readers filter on lifecycle constantly; keep it cheap.
CREATE INDEX IF NOT EXISTS idx_listings_lifecycle ON listings (listing_status)
  WHERE listing_status <> 'active';
-- Reaper scan support.
CREATE INDEX IF NOT EXISTS idx_listings_last_seen ON listings (last_seen_at)
  WHERE listing_type = 'for_sale' AND listing_status IN ('active','pending_verify');
