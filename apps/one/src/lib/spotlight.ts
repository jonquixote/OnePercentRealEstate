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
// with real rent tops an unbounded ratio sort); above this monthly ratio it's
// not a believable deal. Verified against prod 2026-07-16: price >= 30000 AND
// ratio <= 0.05 keeps 93,294 legitimate 1%-clearers with believable top deals
// (3.2-3.4% in Houston). MIN_PRICE = 30000, MAX_RATIO = 0.05.
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
      AND price >= 30000
      AND estimated_rent > 0
      AND rent_price_ratio >= 0.01
      AND rent_price_ratio <= 0.05
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
