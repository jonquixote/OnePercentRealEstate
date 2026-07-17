import { NextResponse } from 'next/server';
import pool from '@/lib/db';

// Top metros by active for_sale listing count, with live median price/rent,
// price-to-rent ratio, and 5-yr FHFA HPI change — powers the homepage
// markets grid (example-home.tsx J1 step 4). Force-dynamic so a missing DB
// at build never fails the build.
export const dynamic = 'force-dynamic';

interface MarketRow {
  zip: string;
  city: string | null;
  state: string | null;
  medianPrice: number | null;
  medianRent: number | null;
  ratio: number | null;
  hpi5y: number | null;
}

// The aggregation below scans the full listings table (~1M rows, two
// percentile_conts per ZIP): ~25s on prod. Market medians move slowly, so
// serve from an in-process cache (same pattern as /api/spotlight) and only
// recompute when it expires. Stale-while-revalidate: after expiry the first
// request returns the stale body immediately and refreshes in the background,
// so no visitor ever waits on the 25s query once the cache is primed.
//
// Fast path: read the precomputed `mv_market_grid` materialized view (refreshed
// ~30 min by the worker). On a fresh env where the migration hasn't run yet the
// relation is missing (SQLSTATE 42P01) — fall back to the live aggregation.
const CACHE_MS = 15 * 60 * 1000;
let cached: { at: number; body: { markets: MarketRow[] } } | null = null;
let refreshing: Promise<void> | null = null;

// Live aggregation (kept as the fallback for pre-migration environments).
// NB: hpi is the FHFA index LEVEL (annual_change_pct carries the yearly %).
// The loader used to write those two columns swapped; fixed together with a
// one-time column-swap repair on prod (load_fhfa_hpi.py, same PR as the fix).
const LIVE_AGGREGATION_SQL = `
  WITH top AS (
    SELECT zip_code,
           max(raw_data->>'city') AS city,
           max(raw_data->>'state') AS state,
           count(*) AS n,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY price) AS median_price,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY estimated_rent)
             FILTER (WHERE estimated_rent > 0) AS median_rent
    FROM listings
    WHERE listing_type = 'for_sale' AND sale_type = 'standard'
      AND price > 10000 AND zip_code ~ '^\\d{5}$'
    GROUP BY zip_code
    ORDER BY n DESC
    LIMIT 8
  )
  SELECT t.zip_code,
         t.city, t.state,
         t.median_price, t.median_rent,
          CASE WHEN t.median_price > 0 THEN round((t.median_rent / t.median_price * 100)::numeric, 2) ELSE NULL END AS ratio,
          CASE WHEN h.five_ago > 0 THEN round(((h.latest - h.five_ago) / h.five_ago * 100)::numeric, 1) ELSE NULL END AS hpi5y
  FROM top t
  LEFT JOIN LATERAL (
    SELECT max(hpi) FILTER (WHERE year = (SELECT max(year) FROM fhfa_zip_hpi WHERE zip5 = t.zip_code)) AS latest,
           max(hpi) FILTER (WHERE year = (SELECT max(year) FROM fhfa_zip_hpi WHERE zip5 = t.zip_code) - 5) AS five_ago
    FROM fhfa_zip_hpi WHERE zip5 = t.zip_code
  ) h ON true
  ORDER BY t.n DESC
`;

export async function GET() {
  if (cached) {
    if (Date.now() - cached.at >= CACHE_MS && !refreshing) {
      refreshing = refreshMarkets().finally(() => {
        refreshing = null;
      });
    }
    return NextResponse.json(cached.body);
  }
  await (refreshing ??= refreshMarkets().finally(() => {
    refreshing = null;
  }));
  return NextResponse.json(cached ?? { markets: [] });
}

async function shapeRows(rows: Array<{
  zip_code: string;
  city: string | null;
  state: string | null;
  median_price: string | null;
  median_rent: string | null;
  ratio: string | null;
  hpi5y: string | null;
}>): Promise<MarketRow[]> {
  return rows.map((r) => ({
    zip: r.zip_code,
    city: r.city,
    state: r.state,
    medianPrice: r.median_price != null ? Number(r.median_price) : null,
    medianRent: r.median_rent != null ? Number(r.median_rent) : null,
    ratio: r.ratio != null ? Number(r.ratio) : null,
    hpi5y: r.hpi5y != null ? Number(r.hpi5y) : null,
  }));
}

async function refreshMarkets(): Promise<void> {
  try {
    const { rows } = await pool.query<{
      zip_code: string;
      city: string | null;
      state: string | null;
      median_price: string | null;
      median_rent: string | null;
      ratio: string | null;
      hpi5y: string | null;
    }>(`
      SELECT zip_code, city, state, median_price, median_rent, ratio, hpi5y
        FROM mv_market_grid ORDER BY n DESC
    `);
    cached = { at: Date.now(), body: { markets: await shapeRows(rows) } };
  } catch (error) {
    // Missing view (fresh env before the migration runs — SQLSTATE 42P01):
    // fall back to the live aggregation so behavior is unchanged.
    const code = (error as { code?: string })?.code;
    if (code === '42P01' && !cached) {
      try {
        const live = await pool.query<{
          zip_code: string;
          city: string | null;
          state: string | null;
          median_price: string | null;
          median_rent: string | null;
          ratio: string | null;
          hpi5y: string | null;
        }>(LIVE_AGGREGATION_SQL);
        cached = { at: Date.now(), body: { markets: await shapeRows(live.rows) } };
        return;
      } catch (liveErr) {
        console.warn('[api/markets] live fallback failed:', liveErr);
      }
    } else {
      console.warn('[api/markets] mv read failed:', error);
    }
    // Keep any previous good body (serve stale on refresh failure); only fall
    // through to empty when there has never been a successful load.
  }
}
