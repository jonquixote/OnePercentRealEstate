/* eslint-disable @typescript-eslint/no-explicit-any */
import { MOTIVATED_SELLER_SCORE_SQL } from '@oper/primitives';

export interface PropertyFilters {
  minPrice?: number;
  maxPrice?: number;
  minBeds?: number;
  minBaths?: number;
  onlyOnePercentRule?: boolean;
  minCapRate?: number;
  minCashOnCash?: number;
  propertyType?: string;
  saleType?: string;
  strategy?: string;
  // Wave 4 — investor filters
  hoaMax?: number;
  domMin?: number;
  hasPriceCut?: boolean;
  minRentConfidence?: number; // 0..1; 1 - band_spread/rent, clamped
  q?: string; // free-text / ZIP search
  // Split-view map sync: restrict the list to the visible viewport.
  bounds?: { north: number; south: number; east: number; west: number };
  // Draw-to-search: 'lng,lat;lng,lat;...' (max 100 vertices). When
  // present it supersedes bounds.
  polygon?: string;
}

const SALE_TYPE_WHITELIST = new Set([
  'standard',
  'foreclosure',
  'pre_foreclosure',
  'reo',
  'auction',
  'short_sale',
]);
const STRATEGY_WHITELIST = new Set(['buy_hold', 'brrrr', 'flip', 'str']);

// Parameterized whitelists — never interpolate these into SQL as identifiers.
// Validate a 'lng,lat;lng,lat;...' polygon string into a closed WKT POLYGON.
// Returns null on anything malformed. Max 100 vertices; every coordinate must
// be a finite number in world range. The caller binds the WKT as a parameter.
export function parsePolygonParam(raw?: string): string | null {
  if (!raw) return null;
  const pts = raw.split(';').map((pair) => pair.split(',').map(Number));
  if (pts.length < 3 || pts.length > 100) return null;
  for (const p of pts) {
    if (p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
    if (Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) return null;
  }
  const ring = [...pts];
  const [fx, fy] = ring[0];
  const [lx, ly] = ring[ring.length - 1];
  if (fx !== lx || fy !== ly) ring.push([fx, fy]); // close the ring
  return `POLYGON((${ring.map(([x, y]) => `${x} ${y}`).join(', ')}))`;
}

const LISTING_SELECT = `
  id,
  address,
  property_type,
  public.is_rentable(property_type) AS is_rentable,
  COALESCE(price, (raw_data->>'list_price')::numeric) as listing_price,
  COALESCE(estimated_rent, (raw_data->>'estimated_rent')::numeric) as estimated_rent,
  COALESCE(bedrooms, (raw_data->>'beds')::numeric) as bedrooms,
  COALESCE(bathrooms, (raw_data->>'full_baths')::numeric) as bathrooms,
  COALESCE(sqft, (raw_data->>'sqft')::numeric) as sqft,
  COALESCE(latitude, (raw_data->>'latitude')::numeric) as latitude,
  COALESCE(longitude, (raw_data->>'longitude')::numeric) as longitude,
  listing_status as status,
  sale_type,
  (SELECT target_ratio FROM resolve_rule(listings.property_type, listings.sale_type, 'buy_hold')) as target_ratio,
  primary_photo,
  images,
  media_blur,
  created_at,
  days_on_market,
  price_cut_pct,
  price_cut_count,
  rent_low,
  rent_high,
  ${MOTIVATED_SELLER_SCORE_SQL} as motivated_score
`;

const SORT_COLUMNS: Record<string, string> = {
  newest: 'created_at DESC',
  price_high: 'price DESC NULLS LAST',
  price_low: 'price ASC NULLS LAST',
  one_percent_high: '(estimated_rent / NULLIF(price, 0)) DESC NULLS LAST',
  one_percent_low: '(estimated_rent / NULLIF(price, 0)) ASC NULLS LAST',
  // Wave 4: served by the partial index idx_listings_price_cut.
  biggest_cut: 'price_cut_pct DESC NULLS LAST',
  stalest: 'days_on_market DESC NULLS LAST',
};

// National average rents by bedroom count (2024 data)
function getNationalAvgRent(beds: number): number {
  const avgRents: Record<number, number> = {
    0: 1100, // Studio
    1: 1300,
    2: 1550,
    3: 1950,
    4: 2350,
    5: 2750,
  };
  return avgRents[Math.min(beds, 5)] || 1550;
}

// Helper to calculate a reasonable fallback rent (internal only)
function getFallbackRent(price: number, beds: number = 3): number {
  const nationalAvg = getNationalAvgRent(beds);
  const maxRent = price * 0.015;
  return Math.min(nationalAvg, maxRent) || nationalAvg;
}

// Re-shape a raw `listings` row into the Property shape the frontend expects.
// Pure: no IO. Falls back rent when the estimate is missing/zero.
// Returns `any` to preserve the prior `row: any` map behavior (callers
// expect the full Property shape including id/address/status).
export function shapeListingRow(row: any): any {
  let rent = Number(row.estimated_rent);
  if (!rent || rent === 0) {
    const beds = Number(row.bedrooms) || 3;
    rent = getFallbackRent(Number(row.listing_price) || 0, beds);
  }

  const images: string[] = (() => {
    if (Array.isArray(row.images) && row.images.length > 0) {
      return row.images.filter((url: any) => typeof url === 'string' && url.length > 0);
    }
    if (row.primary_photo) return [row.primary_photo];
    return [];
  })();

  return {
    ...row,
    listing_price: row.listing_price != null ? Number(row.listing_price) : null,
    estimated_rent: Math.round(rent),
    days_on_market: row.days_on_market != null ? Number(row.days_on_market) : null,
    price_cut_pct: row.price_cut_pct != null ? Number(row.price_cut_pct) : null,
    price_cut_count: row.price_cut_count != null ? Number(row.price_cut_count) : null,
    rent_low: row.rent_low != null ? Number(row.rent_low) : null,
    rent_high: row.rent_high != null ? Number(row.rent_high) : null,
    motivated_score: row.motivated_score != null ? Number(row.motivated_score) : null,
    financial_snapshot: {
      bedrooms: Number(row.bedrooms) || 0,
      bathrooms: Number(row.bathrooms) || 0,
      sqft: Number(row.sqft) || 0,
    },
    latitude: Number(row.latitude) || 0,
    longitude: Number(row.longitude) || 0,
    images,
    media_blur: row.media_blur ?? null,
    raw_data: {},
  };
}

export interface BuildListingsResult {
  sql: string;
  params: unknown[];
}

/**
 * Pure builder for the property-search query. Returns parameterized text +
 * values (no filter value is ever interpolated). Keyset pagination is only
 * correct for `newest` (id tracks created_at closely enough); other sorts
 * fall back to OFFSET.
 */
export function buildListingsQuery(
  filters: PropertyFilters | undefined,
  sortBy: string,
  page: number,
  limit = 100,
  cursor: string | null = null,
): BuildListingsResult {
  const orderBy = SORT_COLUMNS[sortBy] ?? 'created_at DESC';
  const isDesc = orderBy.includes('DESC');

  // Wave 2 audit: cursor pagination is only correct for `newest` because
  // id (BIGSERIAL) is monotonically issued and tracks created_at order
  // closely enough for stable keyset traversal. For price/ratio sorts
  // the cursor can't be just `id` — those columns don't correlate with
  // id, so filtering `id < cursor` would skip valid rows. Fall back to
  // OFFSET on the non-newest sorts; revisit when we move to a
  // typed-cursor encoding (encoded payload of {col_value, id}).
  const cursorCompatible = sortBy === 'newest';
  const useCursor = cursor !== null && cursorCompatible;
  const offset = (page - 1) * limit;

  // Build WHERE clauses dynamically. A $10k price floor drops data-error /
  // placeholder listings (e.g. $1 prices) whose rent/price ratio is noise
  // and would otherwise dominate the yield-ranked sort.
  const whereClauses = ["listing_type = 'for_sale'", 'price > 10000'];
  const params: unknown[] = [];
  let paramIndex = 1;

  // Canonical display: default to standard inventory unless the user opts
  // into a distress type. Strategy drives which rule thresholds apply.
  const saleType =
    filters?.saleType && SALE_TYPE_WHITELIST.has(filters.saleType)
      ? filters.saleType
      : 'standard';
  const strategy =
    filters?.strategy && STRATEGY_WHITELIST.has(filters.strategy)
      ? filters.strategy
      : 'buy_hold';
  whereClauses.push(`sale_type = $${paramIndex++}`);
  params.push(saleType);

  if (filters?.minPrice && filters.minPrice > 0) {
    whereClauses.push(`price >= $${paramIndex++}`);
    params.push(filters.minPrice);
  }
  if (filters?.maxPrice && filters.maxPrice < 10000000) {
    whereClauses.push(`price <= $${paramIndex++}`);
    params.push(filters.maxPrice);
  }
  if (filters?.minBeds && filters.minBeds > 0) {
    whereClauses.push(`bedrooms >= $${paramIndex++}`);
    params.push(filters.minBeds);
  }
  if (filters?.minBaths && filters.minBaths > 0) {
    whereClauses.push(`bathrooms >= $${paramIndex++}`);
    params.push(filters.minBaths);
  }
  if (filters?.onlyOnePercentRule) {
    // Per (property_type, sale_type, strategy) target via the single
    // source of truth resolve_rule(); strategy is whitelisted above.
    // Non-rentable types (land, vacant, farms) are excluded entirely
    // and rows without a rent estimate can't pass the gate. When the
    // resolved rule has no target_ratio (flip / STR), the comparison
    // is NULL and COALESCE→TRUE, i.e. the 1%/rent gate is a no-op for
    // strategies it doesn't apply to (no bogus 1% on flips).
    whereClauses.push(
      `public.is_rentable(listings.property_type) AND estimated_rent IS NOT NULL AND COALESCE((estimated_rent / NULLIF(price, 0)) >= (SELECT target_ratio FROM resolve_rule(listings.property_type, listings.sale_type, $${paramIndex++})), TRUE)`,
    );
    params.push(strategy);
  }
  if (filters?.minCapRate && filters.minCapRate > 0) {
    // Cap rate uses the canonical 50%-rule NOI proxy (matches underwriting.ts capRate()).
    whereClauses.push(`((estimated_rent * 12 * 0.5) / NULLIF(price, 0)) >= $${paramIndex++}`);
    params.push(Number((filters.minCapRate / 100).toFixed(4)));
  }
  if (filters?.minCashOnCash && filters.minCashOnCash > 0) {
    // Cash-on-cash mirrors underwriting.ts exactly with buy-hold default
    // financing (these equal every seeded rule's financing config):
    //   NOI       = rent*12*0.5                       (50% rule)
    //   debtSvc   = amortizing P&I on an 80% LTV, 6.5%/30yr loan, annualized
    //   invested  = 20% down + 3% closing = 23% of price
    //   CoC       = (NOI - debtSvc) / invested
    // Amortization factor uses r=0.065/12, n=360 so it matches monthlyMortgage().
    whereClauses.push(
      `(((estimated_rent * 12 * 0.5) - (price * 0.8 * (0.0054166667 * power(1.0054166667, 360) / (power(1.0054166667, 360) - 1)) * 12)) / NULLIF(price * 0.23, 0)) >= $${paramIndex++}`,
    );
    params.push(Number((filters.minCashOnCash / 100).toFixed(4)));
  }
  if (filters?.propertyType && filters.propertyType !== '') {
    whereClauses.push(`LOWER(property_type) = LOWER($${paramIndex++})`);
    params.push(filters.propertyType);
  }
  // Wave 4 — investor filters
  if (filters?.hoaMax !== undefined && filters.hoaMax >= 0) {
    // Unknown HOA (NULL, ~34% of rows) passes: "cap my HOA" should not
    // hide listings whose dues simply weren't published.
    whereClauses.push(`(hoa_fee IS NULL OR hoa_fee <= $${paramIndex++})`);
    params.push(filters.hoaMax);
  }
  if (filters?.domMin && filters.domMin > 0) {
    whereClauses.push(`days_on_market >= $${paramIndex++}`);
    params.push(filters.domMin);
  }
  if (filters?.hasPriceCut) {
    whereClauses.push(`price_cut_pct > 0`);
  }
  if (filters?.minRentConfidence && filters.minRentConfidence > 0) {
    // confidence = 1 - band_spread/rent (clamped to [0,1]); rows without
    // a band are excluded by definition when the user asks for confidence.
    whereClauses.push(
      `(1 - LEAST((rent_high - rent_low) / NULLIF(estimated_rent, 0), 1)) >= $${paramIndex++}`,
    );
    params.push(Math.min(filters.minRentConfidence, 1));
  }
  if (filters?.q && /^\d{5}$/.test(filters.q)) {
    whereClauses.push(`zip_code = $${paramIndex++}`);
    params.push(filters.q);
  }
  // Draw-to-search polygon takes precedence over viewport bounds.
  // Vertices are validated to finite floats and capped at 100; the WKT
  // string itself is passed as a bind parameter (never interpolated).
  const polygonWkt = parsePolygonParam(filters?.polygon);
  if (polygonWkt) {
    whereClauses.push(
      `geom IS NOT NULL AND ST_Contains(ST_GeomFromText($${paramIndex++}, 4326), geom)`,
    );
    params.push(polygonWkt);
  } else if (filters?.bounds) {
    const b = filters.bounds;
    if ([b.north, b.south, b.east, b.west].every((v) => Number.isFinite(v))) {
      whereClauses.push(`latitude BETWEEN $${paramIndex++} AND $${paramIndex++}`);
      params.push(Math.min(b.south, b.north), Math.max(b.south, b.north));
      whereClauses.push(`longitude BETWEEN $${paramIndex++} AND $${paramIndex++}`);
      params.push(Math.min(b.west, b.east), Math.max(b.west, b.east));
    }
  }

  if (useCursor) {
    whereClauses.push(`id ${isDesc ? '<' : '>'} $${paramIndex++}`);
    params.push(cursor);
  }

  let query: string;
  if (useCursor) {
    const finalOrderBy = `${orderBy}, id ${isDesc ? 'DESC' : 'ASC'}`;
    query = `
      SELECT ${LISTING_SELECT}
      FROM listings
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY ${finalOrderBy}
      LIMIT $${paramIndex++}
    `;
    params.push(limit);
  } else {
    query = `
      SELECT ${LISTING_SELECT}
      FROM listings
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY ${orderBy}
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    params.push(limit, offset);
  }

  return { sql: query, params };
}
