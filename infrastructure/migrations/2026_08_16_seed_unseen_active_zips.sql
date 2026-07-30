-- Seed crawl_jobs rows for active-inventory ZIPs that were never in the backlog.
--
-- The zip_code crawl backlog is a STATIC seed (one row per US ZIP, three visits)
-- that the recycle trigger re-pends forever. Nothing re-seeds it. So any ZIP
-- whose first for_sale listing appeared AFTER the seed was built is invisible to
-- the crawl: it has inventory but no job, and is never swept.
--
-- Measured 2026-07-30: 5 such ZIPs (78541 Edinburg TX, 85139 Maricopa AZ, 27517
-- Chapel Hill NC, 85396 Buckeye AZ, 86445 White Hills AZ), 2 active listings
-- each. A trickle, not a flood — these entered via a neighbouring ZIP's scrape
-- or a recheck.
--
-- This is a ONE-SHOT idempotent backfill, not a lifecycle step. The distinct
-- scan of active listings costs ~13 s (557k rows), which is far too expensive to
-- run on the lifecycle timer for a handful of ZIPs — that is exactly the
-- "probe costs more than it protects" trap documented in docs/HANDOFF.md. If the
-- count grows, schedule this weekly rather than folding it into the tick.
--
-- Idempotent: the NOT EXISTS guard makes re-running a no-op. Newly seeded rows
-- get status='pending' and drain in id order at the back of the current sweep,
-- then recycle with the rest.

INSERT INTO crawl_jobs (region_type, region_value, status)
SELECT 'zip_code', z.zip_code, 'pending'
  FROM (SELECT DISTINCT zip_code FROM listings
         WHERE listing_status = 'active' AND listing_type = 'for_sale'
           AND zip_code ~ '^\d{5}$') z
 WHERE NOT EXISTS (SELECT 1 FROM crawl_jobs c WHERE c.region_value = z.zip_code
                                                AND c.region_type = 'zip_code');
