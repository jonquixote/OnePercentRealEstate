-- OUT-OF-BAND (CONCURRENTLY): Wave 7 index audit round 1.
-- media-health scan was 1.27s mean x 7.5K calls: it pages through listings
-- by (media_url_status, media_last_checked) with no supporting index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_media_health
  ON listings (media_url_status, media_last_checked)
  WHERE primary_photo IS NOT NULL;
