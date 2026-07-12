/**
 * Terminal-internal row shape. The wire schema (ViewportPropertySchema) ships
 * numeric strings half the time because of PostgreSQL/node-postgres casts —
 * we coerce once at the page boundary and never deal with `string | number`
 * downstream. This keeps the table, sort, and aggregation code clean.
 *
 * NB: the backend viewport endpoint does NOT return `estimated_rent`,
 * `days_on_market`, or `year_built`. Until wave 3 lands the async rent
 * pipeline, the terminal derives rent from price at the boundary (see
 * `toRow` below) so 1% and cap show *something* plausible. This is the
 * single biggest mock in this v1; downstream code should not need to care.
 */
export interface PropertyRow {
  id: string;
  address: string;
  /** Price in dollars, integer. Nullable when seller hides price. */
  price: number | null;
  /** Estimated monthly rent (currently derived — see file header). */
  estimated_rent: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  status: string | null;
  primary_photo: string | null;
  latitude: number;
  longitude: number;
  /** Days on market — mocked deterministically from id for now. */
  dom: number;
  /** $ / sqft. Computed once at the boundary. */
  ppsf: number | null;
  /** Monthly 1% rule % — (rent / price) * 100. */
  onePct: number | null;
  /** Gross cap rate % — (rent * 12 / price) * 100. */
  cap: number | null;
  // ---- W2: investor-math source fields (nullable; absent on the viewport
  // tape, populated by /api/properties/query). The column registry
  // (lib/columns.tsx) derives cap/CoC/gross-yield/band-spread from these.
  /** Generated `estimated_rent / price` fraction (server column). */
  rent_price_ratio: number | null;
  /** Fractional price cut (e.g. 0.05 = 5% off). */
  price_cut_pct: number | null;
  /** 0–100 motivated-seller heuristic (server-computed, parity-tested). */
  motivated_score: number | null;
  /** Rent estimate confidence band low/high (monthly $). */
  rent_low: number | null;
  rent_high: number | null;
  /** Year built. */
  year_built: number | null;
  /** Distress/standard sale type. */
  sale_type: string | null;
}

export type Density = "cozy" | "compact" | "dense";

export const DENSITY_ROW_HEIGHT: Record<Density, number> = {
  cozy: 36,
  compact: 28,
  dense: 22,
};
