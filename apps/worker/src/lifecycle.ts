// Listing lifecycle tick: ages stale inventory, reconciles sold matches, flags
// aged pending/contingent rows for re-verification, and enqueues capped ZIP
// rechecks. Runs on a slow timer (LIFECYCLE_TICK_MS) beside the metrics loop in
// crawl.ts — see the wire-up there. NEVER deletes: rows are only re-labeled so
// the read surfaces (Task 4) can exclude them by lifecycle status.
//
// The four SQL steps are exported as pure string constants so they can be
// asserted in lifecycle.test.ts (same style as spotlight.ts) without a DB.

import type { Pool } from 'pg';
import type { WorkerLogger } from './logger.js';

// Stale reaper. A for_sale row we haven't re-seen in STALE_AFTER_DAYS days is
// almost certainly off-market; demote active/pending_verify → stale. Never
// touches already-sold or quarantined (rental_misfiled) rows. The cutoff is a
// bound param ($1 = days) so the SQL text is constant.
export const STALE_SQL = `
  UPDATE listings SET listing_status = 'stale'
   WHERE listing_type = 'for_sale'
     AND listing_status IN ('active','pending_verify')
     AND last_seen_at < now() - ($1 || ' days')::interval`;

// Sold matcher. Exact address equality to sold_listings — both tables build
// `address` with the SAME scraper normalization, so raw equality is
// index-friendly (no lower/trim wrappers that would defeat the indexes). Only
// reconcile sales dated on/after the listing was created (a prior sale of the
// same address must not mark a fresh relisting sold). Copies price+date onto
// the listing so readers can render a SOLD band without a join.
export const SOLD_MATCH_SQL = `
  UPDATE listings l
     SET listing_status = 'sold', sold_price = s.sold_price, sold_date = s.sold_date
    FROM sold_listings s
   WHERE l.listing_type = 'for_sale'
     AND l.listing_status IN ('active','pending_verify','stale')
     AND l.address = s.address
     AND s.sold_date >= l.created_at::date`;

// Pending flag. An active row whose upstream status went PENDING/CONTINGENT and
// hasn't been re-seen in PENDING_VERIFY_AFTER_DAYS days is a verification
// candidate — demote to pending_verify so the recheck enqueue can target its ZIP.
export const PENDING_FLAG_SQL = `
  UPDATE listings SET listing_status = 'pending_verify'
   WHERE listing_type = 'for_sale' AND listing_status = 'active'
     AND raw_data->>'status' IN ('PENDING','CONTINGENT')
     AND last_seen_at < now() - ($1 || ' days')::interval`;

// One recheck job per ZIP holding pending_verify rows; ordinary crawl_jobs rows
// (the driver's normal claim/pace path applies) tagged 'zip_recheck' so
// completion re-stamps last_seen_at via the normal scrape passes. Capped at $1
// ZIPs (busiest first) and idempotent: skips any ZIP that already has an open
// recheck job. The `^\d{5}$` guard keeps non-ZIP region values out.
export const RECHECK_ENQUEUE_SQL = `
  INSERT INTO crawl_jobs (region_type, region_value, status)
  SELECT 'zip_recheck', z.zip_code, 'pending'
    FROM (SELECT zip_code, count(*) AS n FROM listings
           WHERE listing_status = 'pending_verify' AND zip_code ~ '^\\d{5}$'
           GROUP BY zip_code ORDER BY n DESC LIMIT $1) z
   WHERE NOT EXISTS (SELECT 1 FROM crawl_jobs c
                      WHERE c.region_value = z.zip_code
                        AND c.region_type = 'zip_recheck'
                        AND c.status IN ('pending','processing'))`;

export type LifecycleCfg = { staleAfterDays: number; pendingVerifyAfterDays: number; recheckBatch: number };
export type LifecycleStats = { staled: number; soldMatched: number; pendingFlagged: number; rechecksEnqueued: number };

export async function runLifecycleTick(pool: Pool, log: WorkerLogger, cfg: LifecycleCfg): Promise<LifecycleStats> {
  const staled = (await pool.query(STALE_SQL, [cfg.staleAfterDays])).rowCount ?? 0;
  const soldMatched = (await pool.query(SOLD_MATCH_SQL)).rowCount ?? 0;
  const pendingFlagged = (await pool.query(PENDING_FLAG_SQL, [cfg.pendingVerifyAfterDays])).rowCount ?? 0;
  const rechecksEnqueued = (await pool.query(RECHECK_ENQUEUE_SQL, [cfg.recheckBatch])).rowCount ?? 0;
  const stats = { staled, soldMatched, pendingFlagged, rechecksEnqueued };
  log.info(stats, 'lifecycle tick');
  return stats;
}
