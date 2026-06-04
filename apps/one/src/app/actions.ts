'use server';

import pool from '@/lib/db';
import redis from '@/lib/redis';

const PROPERTY_CACHE_TTL = 60;
const HUD_CACHE_TTL = 86400;
const CACHE_VERSION_KEY = 'props:version';

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

        // Build WHERE clauses dynamically
        const whereClauses = ["listing_type = 'for_sale'"];
        const params: any[] = [];
        let paramIndex = 1;

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
            whereClauses.push(`(estimated_rent / NULLIF(price, 0)) >= 0.01`);
        }
        if (filters?.minCapRate && filters.minCapRate > 0) {
            const capRate = (filters.minCapRate / 100).toFixed(4);
            whereClauses.push(`((estimated_rent * 12) / NULLIF(price, 0)) >= ${capRate}`);
        }
        if (filters?.minCashOnCash && filters.minCashOnCash > 0) {
            const cashOnCash = (filters.minCashOnCash / 100).toFixed(4);
            whereClauses.push(`((estimated_rent * 12 * 0.75 - (price * 0.2 * 0.06)) / NULLIF(price * 0.2, 0)) >= ${cashOnCash}`);
        }
        if (filters?.propertyType && filters.propertyType !== '') {
            whereClauses.push(`LOWER(raw_data->>'style') = LOWER($${paramIndex++})`);
            params.push(filters.propertyType);
        }

        if (useCursor) {
            whereClauses.push(`id ${isDesc ? '<' : '>'} $${paramIndex++}`);
            params.push(cursor);
        }

        // Map 'listings' table to the 'Property' interface shape expected by the frontend
        const selectClause = `
            id,
            address,
            COALESCE(price, (raw_data->>'list_price')::numeric) as listing_price,
            COALESCE(estimated_rent, (raw_data->>'estimated_rent')::numeric) as estimated_rent,
            COALESCE(bedrooms, (raw_data->>'beds')::numeric) as bedrooms,
            COALESCE(bathrooms, (raw_data->>'full_baths')::numeric) as bathrooms,
            COALESCE(sqft, (raw_data->>'sqft')::numeric) as sqft,
            COALESCE(latitude, (raw_data->>'latitude')::numeric) as latitude,
            COALESCE(longitude, (raw_data->>'longitude')::numeric) as longitude,
            listing_status as status,
            primary_photo,
            created_at
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

      const images: string[] = row.primary_photo ? [row.primary_photo].filter(Boolean) : [];

      return {
        ...row,
        listing_price: row.listing_price != null ? Number(row.listing_price) : null,
        estimated_rent: Math.round(rent),
        financial_snapshot: {
          bedrooms: Number(row.bedrooms) || 0,
          bathrooms: Number(row.bathrooms) || 0,
          sqft: Number(row.sqft) || 0,
        },
        latitude: Number(row.latitude) || 0,
        longitude: Number(row.longitude) || 0,
        images,
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
      const cacheQuery = 'SELECT safmr_data, last_updated FROM market_benchmarks WHERE zip_code = $1';
      const cacheRes = await client.query(cacheQuery, [zipCode]);

      if (cacheRes.rows.length > 0) {
        const cached = cacheRes.rows[0].safmr_data;
        try {
          await redis.set(cacheKey, JSON.stringify(cached), 'EX', HUD_CACHE_TTL);
        } catch (err) {
          console.warn('Redis cache write failed:', err);
        }
        return cached;
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
        (raw_data->>'estimated_rent')::numeric as estimated_rent,
        COALESCE(bedrooms, (raw_data->>'beds')::numeric) as bedrooms,
        COALESCE(bathrooms, (raw_data->>'full_baths')::numeric) as bathrooms,
        COALESCE(sqft, (raw_data->>'sqft')::numeric) as sqft,
        COALESCE(latitude, (raw_data->>'latitude')::numeric) as latitude,
        COALESCE(longitude, (raw_data->>'longitude')::numeric) as longitude,
        raw_data,
        listing_status as status,
        created_at
      FROM listings
      WHERE id = $1
    `;

const client = await pool.connect();
    try {
      const result = await client.query(query, [id]);

      if (result.rows.length === 0) return null;

      const row = result.rows[0];
      const raw = row.raw_data || {};

      let images = [];
      if (raw.primary_photo) images.push(raw.primary_photo);
      if (raw.alt_photos) {
        const alts = Array.isArray(raw.alt_photos)
          ? raw.alt_photos
          : (typeof raw.alt_photos === 'string' ? raw.alt_photos.split(',') : []);
        images.push(...alts);
      }
      images = images.map(url => url.trim()).filter(url => url.length > 0);

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
        images: images,
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
