import { ImageResponse } from "next/og";

export const alt = "Rental property deal";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#faf7f2";
const TEXT = "#1b1712";
const HAZE = "#6b6258";
const PASS = "#0e7a52";
const BRASS = "#9c7a34";

interface PropertyLite {
  address?: string;
  listing_price?: number;
  estimated_rent?: number;
}

const usd0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

async function loadProperty(id: string): Promise<PropertyLite | null> {
  const base = process.env.NEXT_PUBLIC_SITE_URL;
  if (!base) return null;
  try {
    const res = await fetch(`${base}/api/properties?ids=${encodeURIComponent(id)}`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as PropertyLite[];
    return data?.[0] ?? null;
  } catch {
    return null;
  }
}

export default async function PropertyOpengraphImage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const p = await loadProperty(id);

  const price = p?.listing_price ? usd0.format(p.listing_price) : null;
  const rent = p?.estimated_rent ? usd0.format(p.estimated_rent) : null;

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
          <span style={{ color: INK, fontSize: 260, fontWeight: 800 }}>1%</span>
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
            ONEPERCENT · DEAL
          </span>
          <span
            style={{
              color: TEXT,
              fontSize: p?.address ? 48 : 68,
              fontWeight: 800,
              lineHeight: 1.1,
              marginTop: 18,
            }}
          >
            {p?.address ?? "Rental property analysis"}
          </span>
          {(price || rent) && (
            <div style={{ display: "flex", gap: 56, marginTop: 36 }}>
              {price && (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ color: HAZE, fontSize: 28 }}>Price</span>
                  <span style={{ color: TEXT, fontSize: 52, fontWeight: 800 }}>
                    {price}
                  </span>
                </div>
              )}
              {rent && (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ color: HAZE, fontSize: 28 }}>Est. Rent</span>
                  <span style={{ color: PASS, fontSize: 52, fontWeight: 800 }}>
                    {rent}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    ),
    { ...size },
  );
}
