export type SpotlightLoc = { zip: string; lat: number; lng: number };

export type Spotlight = {
  id: string;
  address: string;
  listing_price: number;
  estimated_rent: number;
  ratio: number;
  rent_low: number | null;
  rent_high: number | null;
  primary_photo: string | null;
  zip: string;
};

export type SpotlightEntry = { metro: { label: string; zip: string }; deal: Spotlight | null };

// Best live 1%-clearing deal near a point. Ranks by ratio desc but breaks ties
// toward closer + fresher so the hero feels local and current. All user-derived
// values are bound params; the 0.01 gate, sanity bounds, and LIMIT are server
// constants written literally into the SQL text below (the sql string has zero
// interpolation, so these are documented here rather than passed as `${}`).
//
// Sanity bounds: below this price it's almost always a data error (a $1 "listing"
// with real rent tops an unbounded ratio sort). MIN_PRICE = 30000.
//
// Mirrors RENT_TRUST.maxRatio (0.02) from apps/one/src/lib/rent-trust.ts.
// Bulk-feed SQL proxy for the absolute plausibility ceiling; the trusted
// spotlight hero must also satisfy it (no HUD/comp joins here). Threshold
// values must be kept identical to RENT_TRUST.maxRatio; both cite each other.
//
// Schema notes (verified against prod 2026-07-16, see task-2-supplement.md):
// - the price column is `price`, not `listing_price` (aliased back in SELECT
//   so the row shape the rest of the plan consumes is unchanged).
// - there is no `is_rentable` column; `estimated_rent > 0` is the effective gate.
// - `primary_photo` is nearly empty on 1%-clearing rows; photos mostly live in
//   the `images` jsonb array, so we COALESCE to the first image.
export function buildSpotlightQuery(loc: SpotlightLoc): { sql: string; params: unknown[] } {
  const sql = `
    SELECT id, address, zip_code, price AS listing_price, estimated_rent, rent_low, rent_high,
           COALESCE(primary_photo, images->>0) AS primary_photo
    FROM listings
    WHERE listing_type = 'for_sale'
      AND listing_status = 'active'
      AND price >= 30000
      AND estimated_rent > 0
      AND rent_price_ratio >= 0.01
      AND rent_price_ratio <= 0.02
      AND geom IS NOT NULL
      AND COALESCE(primary_photo, images->>0) IS NOT NULL
      AND (zip_code = $1 OR ST_DWithin(geom, ST_SetSRID(ST_MakePoint($2, $3), 4326), 0.6))
    ORDER BY rent_price_ratio DESC,
             created_at DESC
    LIMIT 1`;
  return { sql, params: [loc.zip, loc.lng, loc.lat] };
}

export function shapeSpotlight(row: Record<string, unknown>): Spotlight | null {
  const price = Number(row.listing_price);
  const rent = Number(row.estimated_rent);
  if (!(price > 0) || !(rent > 0)) return null;
  return {
    id: String(row.id),
    address: String(row.address ?? ''),
    listing_price: price,
    estimated_rent: rent,
    ratio: rent / price,
    rent_low: row.rent_low != null ? Number(row.rent_low) : null,
    rent_high: row.rent_high != null ? Number(row.rent_high) : null,
    primary_photo: row.primary_photo != null ? String(row.primary_photo) : null,
    zip: row.zip_code != null ? String(row.zip_code) : '',
  };
}

// ---------------------------------------------------------------------------
// Server-side accessors.
//
// buildSpotlightQuery/shapeSpotlight above are pure, but EXECUTION lived inside
// the /api/spotlight route — so a server component had to HTTP-fetch an API
// route on its own box to get data it could query directly. Lifting execution
// and caching here lets the route (ZIP pinning) and the hero (first paint)
// share one code path, one cache, and one definition of "best deal in a metro".
//
// NOTE for client files: this module imports `pool`. Import ONLY types from it
// in a 'use client' file (`import type { TourEntry } …`) or pg is pulled into
// the browser bundle and the build fails.
// ---------------------------------------------------------------------------
import pool from '@/lib/db';
import { METROS, type Metro } from '@/lib/metros';

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; body: SpotlightEntry }>();

export async function spotlightFor(metro: Metro): Promise<SpotlightEntry> {
  const hit = cache.get(metro.zip);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.body;
  try {
    const { sql, params } = buildSpotlightQuery({ zip: metro.zip, lat: metro.lat, lng: metro.lng });
    const res = await pool.query(sql, params);
    const deal = res.rows[0] ? shapeSpotlight(res.rows[0]) : null;
    const body: SpotlightEntry = { metro: { label: metro.label, zip: metro.zip }, deal };
    cache.set(metro.zip, { at: Date.now(), body });
    return body;
  } catch (err) {
    // One metro failing must never take down the whole tour.
    console.error('spotlightFor error:', metro.zip, err);
    return { metro: { label: metro.label, zip: metro.zip }, deal: null };
  }
}

/** A SpotlightEntry narrowed so `deal` is non-null — removes every `deal!`. */
export type TourEntry = SpotlightEntry & { deal: NonNullable<SpotlightEntry['deal']> };

/**
 * Every metro with a live line-clearing deal, plus where the visitor's metro
 * sits in that FILTERED list.
 *
 * Two deliberate changes from the old `?all=1` route path:
 *  1. Promise.all instead of `for (…) await` — a cold tour cost N × latency.
 *  2. startIndex is computed here against the same array the caller renders.
 *     The client used to compute it after a second fetch resolved, so the tour
 *     started on the wrong metro and visibly jumped.
 */
export async function getSpotlightTour(geoMetro: Metro): Promise<{
  entries: TourEntry[];
  startIndex: number;
}> {
  const results = await Promise.all(METROS.map(spotlightFor));
  const entries = results.filter((e): e is TourEntry => e.deal !== null);
  return { entries, startIndex: entries.findIndex((e) => e.metro.zip === geoMetro.zip) };
}
