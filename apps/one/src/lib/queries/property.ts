/* eslint-disable @typescript-eslint/no-explicit-any */
import { MOTIVATED_SELLER_SCORE_SQL } from '@oper/primitives';

const PROPERTY_QUERY = `
SELECT
  id,
  address,
  COALESCE(price, (raw_data->>'list_price')::numeric) as listing_price,
  COALESCE(estimated_rent, (raw_data->>'estimated_rent')::numeric) as estimated_rent,
  COALESCE(bedrooms, (raw_data->>'beds')::numeric) as bedrooms,
  COALESCE(bathrooms, (raw_data->>'full_baths')::numeric) as bathrooms,
  COALESCE(sqft, (raw_data->>'sqft')::numeric) as sqft,
  COALESCE(latitude, (raw_data->>'latitude')::numeric) as latitude,
  COALESCE(longitude, (raw_data->>'longitude')::numeric) as longitude,
  raw_data,
  property_type,
  sale_type,
  (SELECT target_ratio FROM resolve_rule(listings.property_type, listings.sale_type, 'buy_hold')) as target_ratio,
  primary_photo,
  images,
  media_blur,
  listing_status as status,
  created_at,
  hoa_fee,
  tax_annual_amount,
  assessed_value,
  estimated_value,
  county,
  -- Wave 4: enrichment surfaced on the detail page
  neighborhoods,
  property_url,
  last_sold_price,
  last_sold_date,
  description,
  style,
  rent_model_version,
  days_on_market,
  price_cut_pct,
  price_cut_count,
  first_list_price,
  rent_low,
  rent_high,
  ${MOTIVATED_SELLER_SCORE_SQL} as motivated_score,
  -- Wave 3: state-level insurance avg via regex-parse of address.
  -- TODO(Wave 1b): add listings.state column + backfill migration so this
  -- becomes a direct join rather than substring(addr from ', ([A-Z]{2}) ').
  ins_state.annual_premium AS insurance_state_avg
FROM listings
LEFT JOIN insurance_state_avg ins_state
  ON ins_state.state = substring(listings.address from ', ([A-Z]{2}) ')
WHERE listings.id = $1
`;

export function buildPropertyQuery(): string {
  return PROPERTY_QUERY;
}

function getNationalAvgRent(beds: number): number {
  const avgRents: Record<number, number> = {
    0: 1100,
    1: 1300,
    2: 1550,
    3: 1950,
    4: 2350,
    5: 2750,
  };
  return avgRents[Math.min(beds, 5)] || 1550;
}

function getFallbackRent(price: number, beds: number = 3): number {
  const nationalAvg = getNationalAvgRent(beds);
  const maxRent = price * 0.015;
  return Math.min(nationalAvg, maxRent) || nationalAvg;
}

export function shapePropertyRow(row: any) {
  const raw = row.raw_data || {};

  let images: string[] = [];
  if (Array.isArray(row.images) && row.images.length > 0) {
    images = row.images.filter((url: any) => typeof url === 'string' && url.length > 0);
  } else {
    if (row.primary_photo) images.push(row.primary_photo);
    if (raw.primary_photo && !images.includes(raw.primary_photo)) images.push(raw.primary_photo);
    if (raw.alt_photos) {
      const alts = Array.isArray(raw.alt_photos)
        ? raw.alt_photos
        : typeof raw.alt_photos === 'string'
          ? raw.alt_photos.split(',')
          : [];
      images.push(...alts);
    }
    images = images.map((url) => url.trim()).filter((url) => url.length > 0);
  }

  let rent = Number(row.estimated_rent);
  if (!rent || rent === 0) {
    const beds = Number(row.bedrooms) || 3;
    rent = getFallbackRent(Number(row.listing_price), beds);
  }

  const created_at =
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : row.created_at || new Date().toISOString();

  return {
    ...row,
    created_at,
    listing_price: row.listing_price != null ? Number(row.listing_price) : null,
    estimated_rent: Math.round(rent),
    financial_snapshot: {
      bedrooms: Number(row.bedrooms) || 0,
      bathrooms: Number(row.bathrooms) || 0,
      sqft: Number(row.sqft) || 0,
    },
    latitude: Number(row.latitude) || 0,
    longitude: Number(row.longitude) || 0,
    // pg returns NUMERIC as strings; coerce the typed-columns we promote
    // so downstream consumers (resolveCosts, calc helpers, UI) work on
    // numbers like the existing sqft/price fields do.
    rent_model_version: row.rent_model_version ?? null,
    hoa_fee: row.hoa_fee != null ? Number(row.hoa_fee) : null,
    tax_annual_amount: row.tax_annual_amount != null ? Number(row.tax_annual_amount) : null,
    assessed_value: row.assessed_value != null ? Number(row.assessed_value) : null,
    estimated_value: row.estimated_value != null ? Number(row.estimated_value) : null,
    insurance_state_avg: row.insurance_state_avg != null ? Number(row.insurance_state_avg) : null,
    last_sold_price: row.last_sold_price != null ? Number(row.last_sold_price) : null,
    price_cut_pct: row.price_cut_pct != null ? Number(row.price_cut_pct) : null,
    first_list_price: row.first_list_price != null ? Number(row.first_list_price) : null,
    rent_low: row.rent_low != null ? Number(row.rent_low) : null,
    rent_high: row.rent_high != null ? Number(row.rent_high) : null,
    motivated_score: row.motivated_score != null ? Number(row.motivated_score) : null,
    images,
    media_blur: row.media_blur ?? null,
    raw_data: raw,
    status: row.status || 'watch',
  };
}

const DEMOGRAPHICS_ACS_QUERY = `
  SELECT median_hh_income, median_gross_rent, median_home_value, acs_year
  FROM zcta_demographics
  WHERE zcta = $1
  ORDER BY acs_year DESC
  LIMIT 1
`;

const DEMOGRAPHICS_FLOOD_QUERY = `
  SELECT t.nri_overall_rating
  FROM census_tracts t
  JOIN listings l ON l.census_tract = t.geoid
  WHERE l.zip_code = $1
    AND l.census_tract IS NOT NULL
    AND t.nri_overall_score IS NOT NULL
  ORDER BY t.nri_overall_score DESC
  LIMIT 1
`;

export function buildDemographicsQueries(): [string, string] {
  return [DEMOGRAPHICS_ACS_QUERY, DEMOGRAPHICS_FLOOD_QUERY];
}

export function shapeDemographics(acsRes: any, floodRes: any) {
  const acs = acsRes.rows[0] || null;
  const floodRow = floodRes.rows[0] || null;
  if (!acs && !floodRow) return null;
  return {
    median_hh_income: acs?.median_hh_income != null ? Number(acs.median_hh_income) : null,
    median_gross_rent: acs?.median_gross_rent != null ? Number(acs.median_gross_rent) : null,
    median_home_value: acs?.median_home_value != null ? Number(acs.median_home_value) : null,
    nri_rating: floodRow?.nri_overall_rating || null,
  };
}
