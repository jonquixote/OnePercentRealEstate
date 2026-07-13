import { ImageResponse } from "next/og";
import pool from "@/lib/db";

export const alt = "Market investment metrics";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 86400;

const INK = "#faf7f2";
const TEXT = "#1b1712";
const HAZE = "#6b6258";
const PASS = "#0e7a52";
const BRASS = "#9c7a34";

const usd0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export default async function MarketOpengraphImage({
  params,
}: {
  params: Promise<{ zip: string }>;
}) {
  const { zip } = await params;

  let place = zip;
  let medianPrice: number | null = null;
  let medianRent: number | null = null;
  let total = 0;

  try {
    const agg = await pool.query(
      `SELECT count(*)::int AS total_listings,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY price)::numeric(12,2) AS median_price,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY estimated_rent)
                FILTER (WHERE estimated_rent > 0)::numeric(10,2) AS median_rent
       FROM listings
       WHERE zip_code = $1 AND listing_type = 'for_sale' AND sale_type = 'standard' AND price > 10000`,
      [zip],
    );
    const placeRes = await pool.query(
      `SELECT raw_data->>'city' AS city, raw_data->>'state' AS state FROM listings WHERE zip_code = $1 LIMIT 1`,
      [zip],
    );
    const row = agg.rows[0];
    total = Number(row?.total_listings) || 0;
    medianPrice = row?.median_price != null ? Number(row.median_price) : null;
    medianRent = row?.median_rent != null ? Number(row.median_rent) : null;
    const pr = placeRes.rows[0];
    if (pr?.city) place = `${pr.city}${pr.state ? `, ${pr.state}` : ""} · ${zip}`;
  } catch {
    /* fall back to the plain ZIP label */
  }

  const ratio = medianPrice && medianRent ? medianRent / medianPrice : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: INK,
          fontFamily: "Georgia, serif",
        }}
      >
        <div
          style={{
            width: 420,
            height: "100%",
            background: PASS,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span style={{ color: INK, fontSize: 150, fontWeight: 800 }}>{zip}</span>
        </div>
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "0 72px",
          }}
        >
          <span style={{ color: BRASS, fontSize: 34, fontWeight: 700, letterSpacing: 4 }}>
            ONEPERCENT · MARKET
          </span>
          <span
            style={{
              color: TEXT,
              fontSize: 46,
              fontWeight: 800,
              marginTop: 18,
              lineHeight: 1.1,
            }}
          >
            {total > 0 ? place : `${zip} market`}
          </span>
          <div style={{ display: "flex", gap: 52, marginTop: 36 }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ color: HAZE, fontSize: 26 }}>Median price</span>
              <span style={{ color: TEXT, fontSize: 44, fontWeight: 800 }}>
                {medianPrice ? usd0.format(medianPrice) : "—"}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ color: HAZE, fontSize: 26 }}>Median rent</span>
              <span style={{ color: PASS, fontSize: 44, fontWeight: 800 }}>
                {medianRent ? `${usd0.format(medianRent)}/mo` : "—"}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ color: HAZE, fontSize: 26 }}>Price/rent</span>
              <span
                style={{
                  color: ratio && ratio >= 0.01 ? PASS : BRASS,
                  fontSize: 44,
                  fontWeight: 800,
                }}
              >
                {ratio ? `${(ratio * 100).toFixed(2)}%` : "—"}
              </span>
            </div>
          </div>
          <span style={{ color: HAZE, fontSize: 26, marginTop: 28 }}>
            {total > 0
              ? `${total.toLocaleString()} active for-sale listings`
              : "Market data loading"}
          </span>
        </div>
      </div>
    ),
    { ...size },
  );
}
