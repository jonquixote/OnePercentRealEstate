// Date windows the crawl passes actually send, and the provenance they record.
//
// Split out of crawl.ts (which calls loadEnv(), opens a Pool and runs main() at
// import time) so the values can be asserted without booting the worker — the
// same reason crawl-errors.ts exists.
//
// These are the SINGLE SOURCE OF TRUTH. crawl.ts's passes read them and
// crawl_jobs.past_days records them, so the recorded parameter and the sent
// parameter cannot drift apart again.

/** Window for the for_sale, for_rent and foreclosure passes. */
export const FOR_SALE_PAST_DAYS = 30;

/** Window for the sold and pending passes — only needs to overlap the sweep. */
export const RECENT_PAST_DAYS = 14;

/**
 * What past_days the crawl actually ran with, recorded per job so a throughput
 * number can be attributed to its parameters later.
 *
 * This used to read `process.env.SCRAPE_PAST_DAYS`. That was a provenance LIE:
 * prod sets SCRAPE_PAST_DAYS=90, all 5,715 recorded jobs say past_days=90, and
 * no pass has ever sent 90 — the passes hardcoded 30 and 14. Every throughput
 * figure gathered since the column shipped (2026-08-12) was attributed to a
 * parameter that was never in effect.
 *
 * SCRAPE_PAST_DAYS is currently INERT. Wiring it into the passes is a live
 * ingest change and belongs to the deferred `past_days` rollout decision
 * (docs/perf/2026-08-past-days-rollout.md), not to a record-keeping fix. Until
 * that decision lands this reports the for_sale window, because that is the
 * pass every throughput analysis is about.
 */
export function pastDaysForRecord(): number {
  return FOR_SALE_PAST_DAYS;
}
