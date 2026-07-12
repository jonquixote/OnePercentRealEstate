import type { ViewportResponse } from "@oper/api-client";
import type { PropertyRow } from "./types";

/**
 * Numeric-string -> number with a defensible null when the input is blank.
 * The viewport endpoint mixes pg numeric strings and JS numbers depending on
 * the column; this is the single funnel we put them through.
 */
function n(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : null;
}

/**
 * Stable pseudo-random integer from a string id. Used for the mock DOM and
 * sparkline curves until those land for real (Wave 3 / listings_history).
 * Avoids per-render reshuffles that would make the UI feel buggy.
 */
function hashInt(id: string, mod: number, offset = 0): number {
  let h = 2166136261 ^ offset;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  }
  return Math.abs(h) % mod;
}

/** Estimate monthly rent from price. Crude — replaced by Wave 3 pipeline. */
function estimateRent(price: number | null, sqft: number | null): number | null {
  if (price == null || price <= 0) return null;
  // Anchor to ~0.7% of price, nudged up slightly when $/sqft is low (proxy
  // for affordable markets where rents are closer to price). Bounded so we
  // don't fabricate absurd cap rates.
  const ppsf = sqft && sqft > 0 ? price / sqft : null;
  const base = price * 0.007;
  const bump = ppsf != null && ppsf < 150 ? price * 0.0015 : 0;
  return Math.round(base + bump);
}

/** Convert the wire viewport payload to terminal rows. */
export function toRows(data: ViewportResponse | undefined): PropertyRow[] {
  if (!data || data.type !== "properties") return [];
  const out: PropertyRow[] = [];
  for (const raw of data.data) {
    // Discriminate properties vs clusters via the `id` field presence.
    if (!("id" in raw) || !("address" in raw)) continue;
    const id = String(raw.id);
    const price = n(raw.price);
    const sqft = n(raw.sqft);
    // Wave 8 wrap: use the REAL model rent when the payload carries it (the
    // v1 LightGBM estimate with quantile bands); the crude price-anchored
    // guess only remains as a fallback for payloads without it.
    const estimated_rent = n((raw as Record<string, number | string | null>).estimated_rent) ?? estimateRent(price, sqft);
    const ppsf = price != null && sqft != null && sqft > 0 ? price / sqft : null;
    const onePct =
      estimated_rent != null && price != null && price > 0
        ? (estimated_rent / price) * 100
        : null;
    const cap =
      estimated_rent != null && price != null && price > 0
        ? ((estimated_rent * 12) / price) * 100
        : null;
    // W2: carry the investor-math source fields the /api/properties/query
    // feed provides. The viewport tape omits them, so they coerce to null and
    // the derived columns render "—".
    const r = raw as Record<string, number | string | null>;
    const rent_price_ratio =
      n(r.rent_price_ratio) ??
      (estimated_rent != null && price != null && price > 0 ? estimated_rent / price : null);
    out.push({
      id,
      address: raw.address,
      price,
      estimated_rent,
      bedrooms: n(raw.bedrooms),
      bathrooms: n(raw.bathrooms),
      sqft,
      status: raw.status ?? null,
      primary_photo: raw.primary_photo ?? null,
      latitude: raw.latitude,
      longitude: raw.longitude,
      // Real days_on_market when the payload carries it (Wave 1 column);
      // deterministic mock only for payloads that predate it.
      dom: n((raw as Record<string, unknown>).days_on_market as number | string | null) ?? hashInt(id, 180) + 1,
      ppsf,
      onePct,
      cap,
      rent_price_ratio,
      price_cut_pct: n(r.price_cut_pct),
      motivated_score: n(r.motivated_score),
      rent_low: n(r.rent_low),
      rent_high: n(r.rent_high),
      year_built: n((r as Record<string, number | string | null>).year_built),
      sale_type: typeof r.sale_type === "string" ? r.sale_type : null,
    });
  }
  return out;
}

/** Median over a non-null numeric projection. */
export function median(rows: PropertyRow[], pick: (r: PropertyRow) => number | null): number | null {
  const vals: number[] = [];
  for (const r of rows) {
    const v = pick(r);
    if (v != null && Number.isFinite(v)) vals.push(v);
  }
  if (vals.length === 0) return null;
  vals.sort((a, b) => a - b);
  const mid = vals.length >> 1;
  return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

/** Percentile over a non-null numeric projection (0-100). */
export function percentile(
  rows: PropertyRow[],
  pick: (r: PropertyRow) => number | null,
  p: number
): number | null {
  const vals: number[] = [];
  for (const r of rows) {
    const v = pick(r);
    if (v != null && Number.isFinite(v)) vals.push(v);
  }
  if (vals.length === 0) return null;
  vals.sort((a, b) => a - b);
  const idx = (p / 100) * (vals.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return vals[lower];
  const w = idx - lower;
  return vals[lower] * (1 - w) + vals[upper] * w;
}

/** Deterministic 30-point sparkline series in [0,1] from an id. */
export function sparkSeries(id: string, points = 30): number[] {
  const out: number[] = [];
  // Two-octave noise so it looks like price action rather than a sine wave.
  for (let i = 0; i < points; i++) {
    const a = hashInt(id, 1000, i * 7) / 1000;
    const b = hashInt(id, 1000, i * 11 + 91) / 1000;
    out.push(0.5 + (a - 0.5) * 0.7 + (b - 0.5) * 0.3);
  }
  return out;
}
