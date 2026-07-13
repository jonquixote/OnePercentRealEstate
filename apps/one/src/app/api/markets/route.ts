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

export async function GET() {
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
    `);

    const markets: MarketRow[] = rows.map((r) => ({
      zip: r.zip_code,
      city: r.city,
      state: r.state,
      medianPrice: r.median_price != null ? Number(r.median_price) : null,
      medianRent: r.median_rent != null ? Number(r.median_rent) : null,
      ratio: r.ratio != null ? Number(r.ratio) : null,
      hpi5y: r.hpi5y != null ? Number(r.hpi5y) : null,
    }));

    return NextResponse.json({ markets });
  } catch (error) {
    console.warn('[api/markets] failed:', error);
    return NextResponse.json({ markets: [] }, { status: 200 });
  }
}
