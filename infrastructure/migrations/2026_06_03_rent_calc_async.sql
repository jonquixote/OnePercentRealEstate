-- Wave 3 (part 1 / 2): Async rent triangulation — ADDITIVE.
--
-- This file is the safe-to-apply-anytime half of the async-rent transition.
-- It adds the state columns + NOTIFY trigger + drain index + idempotent
-- backfill, but leaves the existing synchronous `set_smart_rent_estimate`
-- BEFORE trigger in place. Both paths coexist:
--
--   * Synchronous path (existing): every insert pays the in-DB triangulation
--     cost and writes estimated_rent itself.
--   * Async enqueue (new): every insert also fires pg_notify so the Node
--     worker (apps/worker/src/rent-estimator.ts) can pick up rows where
--     estimated_rent is still NULL.
--
-- Until the worker is deployed and tailing the notification channel, only
-- the synchronous path matters; the NOTIFY messages are dropped on the
-- floor (LISTEN-less notifications are a no-op).
--
-- Part 2 (`2026_06_03_rent_calc_async_part2.sql`) drops the synchronous
-- trigger once the worker is verified live. Apply it then, not now.
--
-- Reversibility for part 1: ALTER TABLE ... DROP COLUMN on the two new
-- columns + DROP TRIGGER trg_rent_job_enqueue + DROP FUNCTION
-- notify_rent_job_enqueued. The drain index is harmless.

BEGIN;

-- 1. State columns ----------------------------------------------------------
ALTER TABLE listings
    ADD COLUMN IF NOT EXISTS rent_calc_status TEXT NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS rent_model_version TEXT;

-- Constrain to known states; idempotent.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'listings_rent_calc_status_check'
    ) THEN
        ALTER TABLE listings
            ADD CONSTRAINT listings_rent_calc_status_check
            CHECK (rent_calc_status IN ('pending', 'done', 'failed'));
    END IF;
END$$;

-- Partial index so the worker can drain the pending queue cheaply.
CREATE INDEX IF NOT EXISTS idx_listings_rent_calc_pending
    ON listings (id)
    WHERE rent_calc_status = 'pending';

-- 2. Enqueue notification on insert -----------------------------------------
CREATE OR REPLACE FUNCTION notify_rent_job_enqueued()
RETURNS TRIGGER AS $$
BEGIN
    -- Only enqueue when there is no estimate yet. UPDATE paths and rows that
    -- the synchronous trigger already populated do not re-enqueue.
    IF NEW.estimated_rent IS NULL THEN
        PERFORM pg_notify('rent_job_enqueued', NEW.id::text);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rent_job_enqueue ON listings;
CREATE TRIGGER trg_rent_job_enqueue
    AFTER INSERT ON listings
    FOR EACH ROW
    EXECUTE FUNCTION notify_rent_job_enqueued();

-- 3. Backfill rent_calc_status from the existing estimated_rent column ------
--    Rows that already have an estimate are marked 'done' so the worker
--    skips them. Everything else is left at 'pending' (the column default).
UPDATE listings
SET rent_calc_status = 'done'
WHERE estimated_rent IS NOT NULL
  AND rent_calc_status <> 'done';

UPDATE listings
SET rent_calc_status = 'pending'
WHERE estimated_rent IS NULL
  AND rent_calc_status <> 'pending';

COMMIT;
