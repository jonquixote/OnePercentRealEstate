-- Wave 1: capture price/status/DOM changes into listings_history (table exists
-- since 2026_06_04, has never had a trigger -> 0 rows). AFTER UPDATE, WHEN the
-- watched fields actually change, so the scraper's no-op upserts don't write
-- history. Does NOT fire on the enrichment backfill (that never touches price/
-- listing_status/days_on_market). estimated_rent is snapshotted for context.

CREATE OR REPLACE FUNCTION log_listing_history() RETURNS trigger AS $$
BEGIN
  INSERT INTO listings_history (listing_id, observed_at, price, estimated_rent, days_on_market, listing_status)
  VALUES (NEW.id, NOW(), NEW.price, NEW.estimated_rent, NEW.days_on_market, NEW.listing_status)
  ON CONFLICT (listing_id, observed_at) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_listings_history ON listings;
CREATE TRIGGER trg_listings_history
  AFTER UPDATE OF price, listing_status, days_on_market ON listings
  FOR EACH ROW
  WHEN (
    NEW.price          IS DISTINCT FROM OLD.price
    OR NEW.listing_status IS DISTINCT FROM OLD.listing_status
    OR NEW.days_on_market IS DISTINCT FROM OLD.days_on_market
  )
  EXECUTE FUNCTION log_listing_history();

-- Seed a first observation for every currently-priced listing so history has a
-- t0 baseline to diff against (one-time, cheap, no trigger recursion since this
-- is a direct INSERT into the history table).
INSERT INTO listings_history (listing_id, observed_at, price, estimated_rent, days_on_market, listing_status)
SELECT id, created_at, price, estimated_rent, days_on_market, listing_status
FROM listings
WHERE price IS NOT NULL
ON CONFLICT DO NOTHING;
