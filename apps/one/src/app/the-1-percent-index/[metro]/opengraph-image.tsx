import { ImageResponse } from "next/og";
import pool from "@/lib/db";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "1% Rule Index — metro";

// Render on demand — index_snapshots is absent at build time; static
// prerender would crash the build.
export const dynamic = "force-dynamic";

const TEXT = "#2a2520";
const INK = "#faf7f2";
const BRASS = "#9c7a34";
const PASS = "#0e7a52";

const pct = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

export default async function OG({
  params,
}: {
  params: Promise<{ metro: string }>;
}) {
  const { metro } = await params;

  const latest = await pool.query(
    `SELECT to_char(max(month), 'YYYY-MM-DD') AS m FROM index_snapshots`,
  );
  const month: string | null = latest.rows[0]?.m ?? null;

  let label = metro;
  let pctClearing = 0;
  let rank = 0;
  if (month) {
    const cur = await pool.query(
      `SELECT metro_label, pct_clearing,
              (SELECT count(*) FROM index_snapshots s2
                 WHERE s2.month = $2 AND s2.pct_clearing >= s1.pct_clearing) AS rank
       FROM index_snapshots s1
       WHERE s1.month = $2 AND s1.metro_slug = $1`,
      [metro, month],
    );
    const row = cur.rows[0];
    if (row) {
      label = String(row.metro_label);
      pctClearing = Number(row.pct_clearing);
      rank = Number(row.rank);
    }
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
          justifyContent: "center",
        }}
      >
        <span style={{ color: BRASS, fontSize: 30, fontWeight: 700, letterSpacing: 6 }}>
          THE 1% RULE INDEX
        </span>
        <span style={{ color: INK, fontSize: 76, fontWeight: 800, marginTop: 16 }}>
          {label}
        </span>
        <div style={{ display: "flex", alignItems: "baseline", gap: 32, marginTop: 40 }}>
          <span style={{ color: PASS, fontSize: 120, fontWeight: 800 }}>
            {pct.format(pctClearing)}
          </span>
          <span style={{ color: INK, fontSize: 40, opacity: 0.85 }}>
            of listings clear the 1% rule
          </span>
        </div>
        <span style={{ color: BRASS, fontSize: 36, fontWeight: 700, marginTop: 36 }}>
          Rank #{rank} of U.S. metros
        </span>
      </div>
    ),
    { ...size },
  );
}
