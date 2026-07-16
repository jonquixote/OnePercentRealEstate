import { ImageResponse } from "next/og";
import pool from "@/lib/db";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "The 1% Rule Index";

const TEXT = "#2a2520";
const INK = "#faf7f2";
const BRASS = "#9c7a34";
const PASS = "#0e7a52";

const pct = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

export default async function OG() {
  const latest = await pool.query(`SELECT max(month) AS m FROM index_snapshots`);
  const month: string | null = latest.rows[0]?.m
    ? new Date(latest.rows[0].m).toISOString().slice(0, 10)
    : null;

  let top: Array<{ label: string; pctClearing: number }> = [];
  if (month) {
    const cur = await pool.query(
      `SELECT metro_label, pct_clearing FROM index_snapshots WHERE month = $1 ORDER BY pct_clearing DESC LIMIT 3`,
      [month],
    );
    top = cur.rows.map((r) => ({
      label: String(r.metro_label),
      pctClearing: Number(r.pct_clearing),
    }));
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: TEXT,
          color: INK,
          fontFamily: "Georgia, serif",
          padding: "72px 80px",
        }}
      >
        <span style={{ color: BRASS, fontSize: 30, fontWeight: 700, letterSpacing: 6 }}>
          OCTAVO · MONTHLY INDEX
        </span>
        <span style={{ color: INK, fontSize: 84, fontWeight: 800, marginTop: 12 }}>
          THE 1% RULE INDEX
        </span>
        <span style={{ color: INK, fontSize: 36, opacity: 0.85, marginTop: 4 }}>
          Where rentals still cash-flow
        </span>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 48, gap: 18 }}>
          {top.map((t, i) => (
            <div key={t.label} style={{ display: "flex", alignItems: "baseline", gap: 24 }}>
              <span style={{ color: BRASS, fontSize: 40, fontWeight: 800, width: 48 }}>
                {i + 1}
              </span>
              <span style={{ color: INK, fontSize: 40, fontWeight: 700, flex: 1 }}>
                {t.label}
              </span>
              <span style={{ color: PASS, fontSize: 44, fontWeight: 800 }}>
                {pct.format(t.pctClearing)}
              </span>
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
