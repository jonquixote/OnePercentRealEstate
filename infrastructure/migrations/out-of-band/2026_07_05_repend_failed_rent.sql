-- Re-pend rent rows stranded 'failed' by the pre-2026-07-05 worker, which
-- marked ML-connection failures as permanent. Run ONCE, AFTER the
-- breaker-aware worker (wave/0-bleed-stop) is deployed — otherwise the old
-- worker just re-fails them. Idempotent. ~176K rows, single UPDATE is fine.
--
-- Rows whose failure is genuinely permanent (e.g. missing lat/lon, ~800
-- rows) will re-fail under the new classifier — expected, small, correct.
UPDATE listings
   SET rent_calc_status = 'pending',
       updated_at = NOW()
 WHERE rent_calc_status = 'failed';
