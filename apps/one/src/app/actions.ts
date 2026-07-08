'use server';

import pool from '@/lib/db';
import redis from '@/lib/redis';
import { MOTIVATED_SELLER_SCORE_SQL } from '@oper/primitives';

const PROPERTY_CACHE_TTL = 60;
const HUD_CACHE_TTL = 86400;
const CACHE_VERSION_KEY = 'props:version';

// Parameterized whitelists — never interpolate these into SQL as identifiers.
const SALE_TYPE_WHITELIST = new Set([
    'standard', 'foreclosure', 'pre_foreclosure', 'reo', 'auction', 'short_sale',
]);
const STRATEGY_WHITELIST = new Set(['buy_hold', 'brrrr', 'flip', 'str']);

async function getCacheVersion(): Promise<string> {
    try {
        let v = await redis.get(CACHE_VERSION_KEY);
        if (!v) {
            await redis.set(CACHE_VERSION_KEY, '1');
            v = '1';
        }
        return v;
    } catch {
        return '0';
    }
}

async function bumpCacheVersion(): Promise<void> {
    try {
        await redis.incr(CACHE_VERSION_KEY);
    } catch (err) {
        console.warn('Redis cache version bump failed:', err);
    }
}

export async function getProperties(
    page = 1,
    limit = 100,
    sortBy = 'newest',
    filters?: {
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
        q?: string;                 // free-text / ZIP search
    },
    cursor: string | null = null
) {
    try {
        const version = await getCacheVersion();
        const cacheKey = `properties:v${version}:p${page}:l${limit}:s${sortBy}:${JSON.stringify(filters || {})}:c${cursor || 'null'}`;
        try {
            const cached = await redis.get(cacheKey);
            if (cached) return JSON.parse(cached);
        } catch (err) {
            console.warn('Redis cache read failed:', err);
        }

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
        const params: any[] = [];
        let paramIndex = 1;

        // Canonical display: default to standard inventory unless the user opts
        // into a distress type. Strategy drives which rule thresholds apply.
        const saleType = filters?.saleType && SALE_TYPE_WHITELIST.has(filters.saleType)
            ? filters.saleType : 'standard';
        const strategy = filters?.strategy && STRATEGY_WHITELIST.has(filters.strategy)
            ? filters.strategy : 'buy_hold';
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
            whereClauses.push(`public.is_rentable(listings.property_type) AND estimated_rent IS NOT NULL AND COALESCE((estimated_rent / NULLIF(price, 0)) >= (SELECT target_ratio FROM resolve_rule(listings.property_type, listings.sale_type, $${paramIndex++})), TRUE)`);
            params.push(strategy);
        }
        if (filters?.minCapRate && filters.minCapRate > 0) {
            // Cap rate uses the canonical 50%-rule NOI proxy (matches underwriting.ts capRate()).
            const capRate = (filters.minCapRate / 100).toFixed(4);
            whereClauses.push(`((estimated_rent * 12 * 0.5) / NULLIF(price, 0)) >= ${capRate}`);
        }
        if (filters?.minCashOnCash && filters.minCashOnCash > 0) {
            // Cash-on-cash mirrors underwriting.ts exactly with buy-hold default
            // financing (these equal every seeded rule's financing config):
            //   NOI       = rent*12*0.5                       (50% rule)
            //   debtSvc   = amortizing P&I on an 80% LTV, 6.5%/30yr loan, annualized
            //   invested  = 20% down + 3% closing = 23% of price
            //   CoC       = (NOI - debtSvc) / invested
            // Amortization factor uses r=0.065/12, n=360 so it matches monthlyMortgage().
            const cashOnCash = (filters.minCashOnCash / 100).toFixed(4);
            whereClauses.push(`(((estimated_rent * 12 * 0.5) - (price * 0.8 * (0.0054166667 * power(1.0054166667, 360) / (power(1.0054166667, 360) - 1)) * 12)) / NULLIF(price * 0.23, 0)) >= ${cashOnCash}`);
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
            whereClauses.push(`(1 - LEAST((rent_high - rent_low) / NULLIF(estimated_rent, 0), 1)) >= $${paramIndex++}`);
            params.push(Math.min(filters.minRentConfidence, 1));
        }
        if (filters?.q && /^\d{5}$/.test(filters.q)) {
            whereClauses.push(`zip_code = $${paramIndex++}`);
            params.push(filters.q);
        }

        if (useCursor) {
            whereClauses.push(`id ${isDesc ? '<' : '>'} $${paramIndex++}`);
            params.push(cursor);
        }

        // Map 'listings' table to the 'Property' interface shape expected by the frontend
  const selectClause = `
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

        let query: string;
        if (useCursor) {
            const finalOrderBy = `${orderBy}, id ${isDesc ? 'DESC' : 'ASC'}`;
            query = `
                SELECT ${selectClause}
                FROM listings
                WHERE ${whereClauses.join(' AND ')}
                ORDER BY ${finalOrderBy}
                LIMIT $${paramIndex++}
            `;
            params.push(limit);
        } else {
            query = `
                SELECT ${selectClause}
                FROM listings
                WHERE ${whereClauses.join(' AND ')}
                ORDER BY ${orderBy}
                LIMIT $${paramIndex++} OFFSET $${paramIndex++}
            `;
            params.push(limit, offset);
        }

const client = await pool.connect();
  try {
    const result = await client.query(query, params);

    const items = result.rows.map((row: any) => {
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
    });

    const response = {
      items,
      // Only emit a cursor on sorts where the cursor itself is valid
      // for the next page (see cursorCompatible above). On OFFSET sorts
      // the caller should re-issue with `page + 1` instead.
      nextCursor:
        cursorCompatible && items.length === limit
          ? items[items.length - 1].id
          : null,
    };

    try {
      await redis.set(cacheKey, JSON.stringify(response), 'EX', PROPERTY_CACHE_TTL);
    } catch (err) {
      console.warn('Redis cache write failed:', err);
    }

    return response;
  } finally {
    client.release();
  }

    } catch (error) {
        console.error('Database fetch error:', error);
        return { items: [], nextCursor: null };
    }
}

export async function getHudBenchmark(zipCode: string) {
    try {
        const cacheKey = `hud:${zipCode}`;
        try {
            const cached = await redis.get(cacheKey);
            if (cached) return JSON.parse(cached);
        } catch (err) {
            console.warn('Redis cache read failed:', err);
        }

const client = await pool.connect();
    try {
      const hudRes = await client.query(`
        SELECT jsonb_agg(jsonb_build_object('bedrooms', bedrooms, 'safmr', safmr) ORDER BY bedrooms) AS safmr_data,
               MAX(fy) AS fy
        FROM hud_safmr
        WHERE zip_code = $1
      `, [zipCode]);

      if (hudRes.rows.length > 0 && hudRes.rows[0].safmr_data) {
        const result = hudRes.rows[0].safmr_data;
        try {
          await redis.set(cacheKey, JSON.stringify(result), 'EX', HUD_CACHE_TTL);
        } catch (err) {
          console.warn('Redis cache write failed:', err);
        }
        return result;
      }

      console.log(`No HUD SAFMR data available for ${zipCode}`);
      return null;
    } finally {
      client.release();
    }

    } catch (error) {
        console.error('HUD fetch error:', error);
        return null;
    }
}

export async function getProperty(id: string) {
    try {
    const query = `
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

const client = await pool.connect();
    try {
      const result = await client.query(query, [id]);

      if (result.rows.length === 0) return null;

      const row = result.rows[0];
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
          : (typeof raw.alt_photos === 'string' ? raw.alt_photos.split(',') : []);
        images.push(...alts);
      }
      images = images.map(url => url.trim()).filter(url => url.length > 0);
    }

      let rent = Number(row.estimated_rent);
      if (!rent || rent === 0) {
        const beds = Number(row.bedrooms) || 3;
        rent = getFallbackRent(Number(row.listing_price), beds);
      }

      const created_at = row.created_at instanceof Date ? row.created_at.toISOString() : (row.created_at || new Date().toISOString());

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
      images: images,
      media_blur: row.media_blur ?? null,
      raw_data: raw,
        status: row.status || 'watch'
      };
    } finally {
      client.release();
    }

    } catch (error) {
        console.error('Database fetch error:', error);
        return null;
    }
}

export async function getDemographics(zipCode: string) {
    try {
        const client = await pool.connect();
        try {
            const [acsRes, floodRes] = await Promise.all([
                client.query(`
                    SELECT median_hh_income, median_gross_rent, median_home_value, acs_year
                    FROM zcta_demographics
                    WHERE zcta = $1
                    ORDER BY acs_year DESC
                    LIMIT 1
                `, [zipCode]),
                client.query(`
                    SELECT t.nri_overall_rating
                    FROM census_tracts t
                    JOIN listings l ON l.census_tract = t.geoid
                    WHERE l.zip_code = $1
                      AND l.census_tract IS NOT NULL
                      AND t.nri_overall_score IS NOT NULL
                    ORDER BY t.nri_overall_score DESC
                    LIMIT 1
                `, [zipCode]),
            ]);
            const acs = acsRes.rows[0] || null;
            const floodRow = floodRes.rows[0] || null;
            if (!acs && !floodRow) return null;
            return {
                median_hh_income: acs?.median_hh_income != null ? Number(acs.median_hh_income) : null,
                median_gross_rent: acs?.median_gross_rent != null ? Number(acs.median_gross_rent) : null,
                median_home_value: acs?.median_home_value != null ? Number(acs.median_home_value) : null,
                nri_rating: floodRow?.nri_overall_rating || null,
            };
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Demographics fetch error:', error);
        return null;
    }
}

// National average rents by bedroom count (2024 data)
function getNationalAvgRent(beds: number): number {
    const avgRents: Record<number, number> = {
        0: 1100,  // Studio
        1: 1300,
        2: 1550,
        3: 1950,
        4: 2350,
        5: 2750,
    };
    return avgRents[Math.min(beds, 5)] || 1550;
}

// Helper to calculate a reasonable fallback rent (not exported - internal only)
function getFallbackRent(price: number, beds: number = 3): number {
    // Use national average, but cap at 1.5% of price for sanity
    const nationalAvg = getNationalAvgRent(beds);
    const maxRent = price * 0.015;
    return Math.min(nationalAvg, maxRent) || nationalAvg;
}

// Persist smart estimate to database
export async function updatePropertyRent(id: string, rent: number, method?: string) {
    try {
const client = await pool.connect();
    try {
      await client.query(
        `UPDATE listings
        SET estimated_rent = $1, updated_at = NOW()
        WHERE id = $2`,
        [Math.round(rent), id]
      );
      await bumpCacheVersion();
      return { success: true };
    } finally {
      client.release();
    }
    } catch (error) {
        console.error('Failed to update rent:', error);
        return { success: false, error };
    }
}
