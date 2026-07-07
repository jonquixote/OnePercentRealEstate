-- Wave 4: trigger-maintained price-cut facts on listings.
--
-- Why columns, not query-time laterals: sorting/filtering by "biggest cut"
-- via a lateral into listings_history would probe history once per listings
-- row on every list query (~946K probes for an OFFSET sort). Derived columns
-- keep the hot path a plain column op with a tiny partial index; the history
-- trigger maintains them for free on the same UPDATE that writes history.
--
-- first_list_price = earliest observed price (from the t0 seed or the first
-- scraper upsert). price_cut_pct = fraction below first price (only when
-- positive). price_cut_count = number of observed decreases.

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS first_list_price NUMERIC,
  ADD COLUMN IF NOT EXISTS price_cut_pct    NUMERIC,
  ADD COLUMN IF NOT EXISTS price_cut_count  INT NOT NULL DEFAULT 0;

-- Replace the AFTER trigger with a BEFORE trigger so the same function can
-- both write the history row and stamp the derived fields onto NEW.
CREATE OR REPLACE FUNCTION log_listing_history() RETURNS trigger AS $$
BEGIN
  INSERT INTO listings_history (listing_id, observed_at, price, estimated_rent, days_on_market, listing_status)
  VALUES (NEW.id, NOW(), NEW.price, NEW.estimated_rent, NEW.days_on_market, NEW.listing_status)
  ON CONFLICT (listing_id, observed_at) DO NOTHING;

  -- Maintain price-cut facts. first_list_price is sticky once set.
  IF NEW.price IS NOT NULL THEN
    IF NEW.first_list_price IS NULL THEN
      NEW.first_list_price := COALESCE(
        (SELECT MIN(lh.price) FROM listings_history lh WHERE lh.listing_id = NEW.id),
        OLD.first_list_price, OLD.price, NEW.price
      );
    END IF;
    IF OLD.price IS NOT NULL AND NEW.price < OLD.price THEN
      NEW.price_cut_count := COALESCE(OLD.price_cut_count, 0) + 1;
    END IF;
    IF NEW.first_list_price > 0 AND NEW.price < NEW.first_list_price THEN
      NEW.price_cut_pct := round((NEW.first_list_price - NEW.price) / NEW.first_list_price, 4);
    ELSE
      NEW.price_cut_pct := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_listings_history ON listings;
CREATE TRIGGER trg_listings_history
  BEFORE UPDATE OF price, listing_status, days_on_market ON listings
  FOR EACH ROW
  WHEN (
    NEW.price          IS DISTINCT FROM OLD.price
    OR NEW.listing_status IS DISTINCT FROM OLD.listing_status
    OR NEW.days_on_market IS DISTINCT FROM OLD.days_on_market
  )
  EXECUTE FUNCTION log_listing_history();

-- Backfill of existing rows is OUT-OF-BAND (a single 944K-row UPDATE
-- deadlocked against live scraper/worker writers on first attempt — the
-- large-table discipline exists for a reason). Run after this migration:
--   infrastructure/migrations/out-of-band/2026_07_07_backfill_price_cuts.sql
-- New/updated rows are maintained by the trigger above regardless.
