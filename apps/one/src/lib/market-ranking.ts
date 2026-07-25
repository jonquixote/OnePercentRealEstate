import pool from '@/lib/db';
import { cachedSWR } from '@/lib/cache-swr';

/**
 * The nationwide ZIP ranking (top 600 markets by active for-sale inventory).
 *
 * WHY THIS EXISTS: the market page was computing this on EVERY request. The app
 * logged `[SLOW QUERY] 9985ms` for it, and it was ~10s of every market page's
 * 10.4s first render — /market/77002 and /market/44102 both paid it in full.
 *
 * The result does not depend on the requested ZIP at all: it is the same list
 * for every one of the 21,466 market pages, used only to find a ZIP's rank and
 * its peer markets for navigation. So it is computed once and cached.
 *
 * Ranking by inventory count moves on the crawl cadence (slowly, in aggregate),
 * so an hour of freshness is generous and stale-while-revalidate means a user
 * never waits for it.
 */

const FRESH_S = 3600;      // 1 hour
const STALE_S = 86_400;    // serve stale for a day while refreshing behind

const RANKING_SQL = `
  SELECT zip_code FROM (
    SELECT zip_code, count(*) AS c
    FROM listings
    WHERE listing_type = 'for_sale' AND sale_type = 'standard' AND zip_code ~ '^\\d{5}$'
      AND listing_status NOT IN ('sold','stale','rental_misfiled')
    GROUP BY zip_code
  ) t ORDER BY c DESC LIMIT 600
`;

/** Ordered ZIPs, densest market first. Cached; never runs per-request. */
export async function getMarketRanking(): Promise<string[]> {
  return cachedSWR<string[]>('market:ranking:v1', FRESH_S, STALE_S, async () => {
    const client = await pool.connect();
    try {
      const res = await client.query(RANKING_SQL);
      return (res.rows as Array<{ zip_code: string }>).map((r) => r.zip_code);
    } finally {
      client.release();
    }
  });
}
