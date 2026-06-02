'use server';

import pool from '@/lib/db';

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
    }
) {
    try {
        const offset = (page - 1) * limit;

  const SORT_COLUMNS: Record<string, string> = {
    newest: 'created_at DESC',
    price_high: 'price DESC NULLS LAST',
    price_low: 'price ASC NULLS LAST',
    one_percent_high: '(estimated_rent / NULLIF(price, 0)) DESC NULLS LAST',
    one_percent_low: '(estimated_rent / NULLIF(price, 0)) ASC NULLS LAST',
  };
  const orderBy = SORT_COLUMNS[sortBy] ?? 'created_at DESC';

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

        // Map 'listings' table to the 'Property' interface shape expected by the frontend
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
  listing_status as status,
  primary_photo,
  created_at
      FROM listings
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY ${orderBy}
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

        params.push(limit, offset);

const client = await pool.connect();
  try {
    const result = await client.query(query, params);

    return result.rows.map((row: any) => {
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
  } finally {
    client.release();
  }

    } catch (error) {
        console.error('Database fetch error:', error);
        return [];
    }
}

export async function getHudBenchmark(zipCode: string) {
    try {
const client = await pool.connect();
    try {
      const cacheQuery = 'SELECT safmr_data, last_updated FROM market_benchmarks WHERE zip_code = $1';
      const cacheRes = await client.query(cacheQuery, [zipCode]);

      if (cacheRes.rows.length > 0) {
        const cached = cacheRes.rows[0];
        return cached.safmr_data;
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
        url,
        property_url,
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
      return { success: true };
    } finally {
      client.release();
    }
    } catch (error) {
        console.error('Failed to update rent:', error);
        return { success: false, error };
    }
}
