-- Make rent_calc_status honest, and make failures triageable.
--
-- MEASURED PROBLEM (prod, 2026-07-28):
--   done            1,315,777   of which 88,188 have estimated_rent IS NULL
--   failed              6,204   with no recorded reason at all
--
-- Every one of those 88,188 came from the same place: the SQL settle path marks
-- non-rentable property types 'done' with a NULL rent (rent_model_version =
-- 'non_rentable_skip'). "Done" there means "finished processing", but every
-- reader takes it to mean "has an estimate" — including stats-compute's
-- `rent_calc_status = 'done' AND is_rentable(property_type)` count, which is
-- how 404 of these ended up counted as estimated while holding no estimate.
--
-- Those 404 are listings whose property type is rentable NOW but was skipped as
-- non-rentable earlier. They are recoverable, so they go back in the queue
-- rather than being relabelled (relabel, never delete — but also never strand).

-- 1. A place to record WHY a row failed. Untriageable failures stay failures.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS rent_calc_error text;

-- 2. Allow the honest terminal status.
ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_rent_calc_status_check;
ALTER TABLE listings ADD CONSTRAINT listings_rent_calc_status_check
  CHECK (rent_calc_status IN ('pending', 'done', 'failed', 'not_applicable'));

-- 3. Triage queries are always (status, lifecycle) — e.g. "failed AND active".
CREATE INDEX IF NOT EXISTS idx_listings_rent_calc_triage
  ON listings (rent_calc_status, listing_status);

-- 4. Re-queue the recoverable rows FIRST, so the relabel below cannot swallow
--    them. Rentable type + no estimate = the estimator should try again.
UPDATE listings
   SET rent_calc_status = 'pending',
       rent_calc_error  = NULL,
       updated_at       = NOW()
 WHERE rent_calc_status = 'done'
   AND estimated_rent IS NULL
   AND rent_model_version = 'non_rentable_skip'
   AND public.is_rentable(property_type);

-- 5. Relabel the genuinely un-estimatable ones. Not a failure — there is
--    nothing to estimate for vacant land.
UPDATE listings
   SET rent_calc_status = 'not_applicable',
       rent_calc_error  = 'property_type not rentable',
       updated_at       = NOW()
 WHERE rent_calc_status = 'done'
   AND estimated_rent IS NULL;

-- 6. Now the invariant holds, so enforce it. This is the whole point: a status
--    that can lie will eventually lie, and every reader downstream inherits it.
ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_done_implies_rent;
ALTER TABLE listings ADD CONSTRAINT listings_done_implies_rent
  CHECK (rent_calc_status <> 'done' OR estimated_rent IS NOT NULL);
