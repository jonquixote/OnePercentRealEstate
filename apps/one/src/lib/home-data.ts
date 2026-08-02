import pool from '@/lib/db';
import { computeAndStoreStats, readStatsSummary, type StatsPayload } from '@/lib/stats-compute';

/**
 * Server-side home page data.
 *
 * The page previously fetched all three of these from the browser — useStats()
 * plus two useEffect fetches to /api/stats/cuts and /api/stats/median-rent —
 * so nothing above the fold existed until hydration and every visit paid three
 * HTTP round-trips to our own box. These read the same stored stats row
 * directly.
 *
 * They are intentionally forgiving: the home page must still render if a stats
 * query fails, so each returns a null/undefined rather than throwing.
 */

export type HomeStats = StatsPayload & { medianRent: number | null };

export async function getHomeStats(strategy: string): Promise<HomeStats | null> {
  try {
    const stored = await readStatsSummary(strategy);
    if (stored) return stored.payload;
    // Cold cache (first boot after a deploy, or a strategy never computed):
    // compute and store it once, then serve it.
    return await computeAndStoreStats(strategy);
  } catch (err) {
    console.error('getHomeStats failed:', err);
    return null;
  }
}

/**
 * Live price cuts.
 *
 * NOTE the field name. /api/stats/cuts returns `{ count }`, but page.tsx read
 * `d?.priceCuts` — a key that route never emitted — so the hero's "price cuts
 * live" figure has always rendered as an em-dash despite 85,748 real cuts in
 * the data. Reading the column directly removes the mismatch entirely.
 */
export async function getPriceCuts(): Promise<number | undefined> {
  try {
    const res = await pool.query(
      `SELECT count(*)::int AS count
         FROM listings
        WHERE listing_type = 'for_sale'
          AND sale_type = 'standard'
          AND price > 10000
          AND price_cut_pct > 0
          AND listing_status NOT IN ('sold','stale','rental_misfiled')`,
    );
    const n = res.rows[0]?.count;
    return typeof n === 'number' ? n : undefined;
  } catch (err) {
    console.error('getPriceCuts failed:', err);
    return undefined;
  }
}

/** Median estimated rent — stored on the stats row, not recomputed (7.1s cold). */
export async function getMedianRent(): Promise<number | null> {
  try {
    const stored = await readStatsSummary('buy_hold');
    return stored?.payload.medianRent ?? null;
  } catch (err) {
    console.error('getMedianRent failed:', err);
    return null;
  }
}
