-- 2026_06_03_media_abstraction.sql
-- Wave 1: seam for the future image-rehost flip.
--
-- This migration ONLY adds the columns + the fallback table. It does NOT
-- start checking URLs, does NOT rehost images, does NOT change which URL
-- the app serves. Wave 7's media-health crawler will populate
-- media_url_status; whenever live traffic justifies the storage bill,
-- a future migration will populate media_fallback per row and the
-- <Media> primitive (added Wave 4) will start preferring it.

-- canonical source URL on the listing site (Zillow, Redfin, Realtor.com).
-- separate from primary_photo (image URL) and from the various raw_data fields.
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS property_url TEXT;

-- media health columns
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS media_url_status SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS media_last_checked TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS media_source TEXT NOT NULL DEFAULT 'origin',
  ADD COLUMN IF NOT EXISTS media_blur BYTEA;

COMMENT ON COLUMN listings.media_url_status IS
  '0=unknown, 200=ok, 4xx=broken-permanent, 5xx=transient. Filled by the media-health crawler (Wave 7).';
COMMENT ON COLUMN listings.media_source IS
  'origin = source URL (Zillow/Realtor/etc). Future values: r2, cf-images.';
COMMENT ON COLUMN listings.media_blur IS
  'Optional 8x8 jpeg LQIP (~50 bytes) for blur-up placeholders on card grids.';

-- partial index lets the crawler cheaply find rows needing a recheck
CREATE INDEX IF NOT EXISTS idx_listings_media_recheck
  ON listings (media_last_checked)
  WHERE media_url_status = 0 OR media_url_status >= 500;

-- fallback URL table — empty for now. When the flip happens, the
-- <Media> primitive resolves a listing's image as:
--   media_fallback.url (if row exists) -> media_source==r2 ? r2_url : primary_photo
CREATE TABLE IF NOT EXISTS media_fallback (
  listing_id BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('primary', 'alt', 'floorplan')),
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (listing_id, kind, url)
);

CREATE INDEX IF NOT EXISTS idx_media_fallback_listing
  ON media_fallback (listing_id);
