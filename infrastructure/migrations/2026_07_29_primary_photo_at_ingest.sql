-- Keep listings.primary_photo populated at ingest, for every writer.
--
-- WHY THIS AND NOT A CHANGE TO THE SCRAPER'S UPSERT:
-- The scraper builds `images` (with the primary photo as element 0) and writes
-- it on both INSERT and ON CONFLICT, but `primary_photo` is simply absent from
-- its column list — which is why 140 of 449,654 active listings had it. Adding
-- the column there means adding a positional %s to a 40-column INSERT whose
-- placeholders and parameter tuple must stay aligned by hand; that fragility is
-- the same class of problem that let this gap exist. A trigger states the
-- invariant once, applies to every writer (scraper, workers, manual repair),
-- and cannot drift out of position.
--
-- Scoped to `UPDATE OF images` so it does NOT fire on the high-volume updates
-- that never touch photos (the rent estimator writes 5,000 rows a batch, the
-- lifecycle reaper more).
--
-- COALESCE order matters: an existing value wins, so a manual correction is
-- never clobbered by a re-crawl.

CREATE OR REPLACE FUNCTION set_primary_photo_from_images() RETURNS trigger AS $$
BEGIN
  IF NEW.primary_photo IS NULL
     AND NEW.images IS NOT NULL
     AND jsonb_typeof(NEW.images) = 'array'
     AND jsonb_array_length(NEW.images) > 0
     AND jsonb_typeof(NEW.images->0) = 'string'
  THEN
    NEW.primary_photo := NEW.images->>0;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_primary_photo_from_images ON listings;
CREATE TRIGGER trg_primary_photo_from_images
  BEFORE INSERT OR UPDATE OF images ON listings
  FOR EACH ROW
  EXECUTE FUNCTION set_primary_photo_from_images();
