-- Re-pend rent rows stranded 'failed' by the 2026-07-08 ML outage.
--
-- Root cause: services/ml_rent_estimator/dataset.py shipped with an
-- IndentationError (import-time crash) + the trained model was stale at 11
-- features vs the code's 13 (Track B added zcta_med_income/rent). ML 500'd
-- on every predict, and the worker's old taxonomy classified `ml 500` as
-- PERMANENT — condemning ~25.8K rows the breaker should have protected.
--
-- Fixed: dataset.py rebuilt, model retrained to 13 features (PROMOTED,
-- holdout MAE $487.90 vs HUD $780.54), and apps/worker/src/ml-errors.ts
-- now classifies 5xx as transient. Run this ONCE, AFTER that worker is
-- deployed and ML serves v1 — else the rows just re-fail.
--
-- Scope: rows that can actually succeed under the restored v1 —
--   (a) 'failed' rows condemned by the old 500=permanent classifier, and
--   (b) 'done' rows that got the degraded 'v0-fallback' estimate (no p10-p90
--       bands) while the model was stale.
-- Both are limited to rentable + has-coordinates. The ~1.5K no-coords
-- failures are genuinely permanent and left as-is (they re-fail instantly).
-- Status-only flip — updated_at is left untouched on purpose (large-table
-- discipline: backfills must not move the crawler's freshness signals).
-- Idempotent.
UPDATE listings
   SET rent_calc_status = 'pending'
 WHERE (rent_calc_status = 'failed' OR rent_model_version = 'v0-fallback')
   AND public.is_rentable(property_type)
   AND latitude IS NOT NULL
   AND longitude IS NOT NULL;
