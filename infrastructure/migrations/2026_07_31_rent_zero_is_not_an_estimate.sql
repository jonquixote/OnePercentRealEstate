-- A rent of zero is not an estimate. It is the absence of one.
--
-- The 2026_07_28 honesty work added listings_done_implies_rent, asserting that
-- `done` implies `estimated_rent IS NOT NULL`. That constraint has a loophole:
-- NOT NULL is satisfied by 0, and 0 is the legacy "no rent" sentinel this
-- codebase has been retiring. Measured on prod 2026-07-25:
--
--   done            1,237,985   of which 36,979 hold estimated_rent = 0
--   ...and all 36,979 are rent_model_version = 'non_rentable_skip'
--
-- Property types: 27,221 LAND, 1,479 FARM, and a long tail. A rent estimate for
-- vacant land is meaningless, which is why the estimator wrote 0 rather than a
-- number — but `done` still claimed an estimate existed.
--
-- These do not currently pollute the ratio-ranked surfaces (0/price = 0 falls
-- below every target ratio, and most read paths filter estimated_rent > 0), so
-- this is a correctness fix rather than an incident. It closes the loophole
-- before something starts trusting the column.

-- 1. Relabel to the honest terminal status, same treatment the NULL-rent rows
--    got on 2026-07-28.
UPDATE listings
   SET rent_calc_status = 'not_applicable',
       estimated_rent   = NULL,
       rent_calc_error  = 'property_type not rentable',
       updated_at       = NOW()
 WHERE rent_calc_status = 'done'
   AND estimated_rent = 0;

-- 2. Close the loophole. `done` now requires a rent that is actually a rent.
--    The estimator was updated in the same change (isScored in rent-scored.ts)
--    so no write path can violate this.
ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_done_implies_rent;
ALTER TABLE listings ADD CONSTRAINT listings_done_implies_rent
  CHECK (rent_calc_status <> 'done' OR (estimated_rent IS NOT NULL AND estimated_rent > 0));
