-- Wave 3 (part 2 / 2): Async rent triangulation — DESTRUCTIVE.
--
-- **Do NOT apply this migration until apps/worker/src/rent-estimator.ts
-- is deployed and verified listening on `rent_job_enqueued`.**
--
-- This drops the synchronous `set_smart_rent_estimate` BEFORE trigger.
-- After this lands, new listings arrive with `estimated_rent = NULL,
-- rent_calc_status = 'pending'`; the worker picks them up via the
-- AFTER-INSERT NOTIFY from part 1 and writes back the estimate.
--
-- The `calculate_smart_rent(...)` function itself stays intact so the
-- worker's FastAPI shim can call it during the transition.
--
-- Verification gate (run BEFORE applying):
--   1. `docker logs infrastructure-worker-rent-1` shows
--      "rent-estimator: listening on rent_job_enqueued".
--   2. SELECT count(*) FROM listings WHERE rent_calc_status='pending';
--      is steady or shrinking over a 10 min window — the worker is
--      draining.
--
-- Rollback:
--   psql -c "CREATE TRIGGER set_smart_rent_estimate BEFORE INSERT OR UPDATE
--           ON listings FOR EACH ROW EXECUTE FUNCTION set_smart_rent_estimate()"
--   (the trigger function is preserved; only the trigger is dropped here).

BEGIN;

DROP TRIGGER IF EXISTS set_smart_rent_estimate ON listings;

COMMIT;
