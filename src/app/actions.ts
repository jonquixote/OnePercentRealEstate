'use server';

import pool from '@/lib/db';

export async function getProperties(page = 1, limit = 100, sortBy = 'newest') {
    try {
        const offset = (page - 1) * limit;

        let orderBy = 'created_at DESC';
        if (sortBy === 'price_high') orderBy = 'listing_price DESC NULLS LAST';
        if (sortBy === 'price_low') orderBy = 'listing_price ASC NULLS LAST';
        if (sortBy === 'one_percent_high') orderBy = '(estimated_rent / NULLIF(listing_price, 0)) DESC NULLS LAST';
        if (sortBy === 'one_percent_low') orderBy = '(estimated_rent / NULLIF(listing_price, 0)) ASC NULLS LAST';
        if (sortBy === 'newest') orderBy = 'created_at DESC';

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
        raw_data,
        listing_status as status,
        created_at
      FROM listings
      WHERE listing_status = 'FOR_SALE' OR listing_status IS NULL
      ORDER BY ${orderBy}
      LIMIT $1 OFFSET $2
    `;

        const client = await pool.connect();
        const result = await client.query(query, [limit, offset]);
        client.release();

        return result.rows.map((row: any) => {
            const raw = row.raw_data || {};
            // Image Logic
            let images: string[] = [];
            if (raw.primary_photo) images.push(raw.primary_photo);
            if (raw.alt_photos) {
                const alts = Array.isArray(raw.alt_photos)
                    ? raw.alt_photos
                    : (typeof raw.alt_photos === 'string' ? raw.alt_photos.split(',') : []);
                images.push(...alts);
            }
            // Clean up images
            images = images.map((url: string) => url.trim()).filter((url: string) => url.length > 0);

            // Rent estimation priority:
            // 1. Use estimated_rent from scraped data if available
            // 2. Fall back to national average by bedroom count
            // (Smart estimate from /api/estimate-rent is fetched client-side for detailed view)
            let rent = Number(row.estimated_rent);
            if (!rent || rent === 0) {
                // Use national average based on bedrooms - more accurate than 0.8%
                const beds = Number(row.bedrooms) || 3;
                rent = getFallbackRent(Number(row.listing_price), beds);
            }

            return {
                ...row,
                listing_price: Number(row.listing_price),
                estimated_rent: Math.round(rent),
                financial_snapshot: {
                    bedrooms: Number(row.bedrooms),
                    bathrooms: Number(row.bathrooms),
                    sqft: Number(row.sqft),
                },
                latitude: Number(row.latitude),
                longitude: Number(row.longitude),
                images: images, // Pass mapped images
                raw_data: raw
            };
        });

    } catch (error) {
        console.error('Database fetch error:', error);
        return [];
    }
}

export async function getHudBenchmark(zipCode: string) {
    try {
        const client = await pool.connect();

        // Check if we have real HUD SAFMR data in market_benchmarks
        const cacheQuery = 'SELECT safmr_data, last_updated FROM market_benchmarks WHERE zip_code = $1';
        const cacheRes = await client.query(cacheQuery, [zipCode]);

        client.release();

        if (cacheRes.rows.length > 0) {
            const cached = cacheRes.rows[0];
            // Return cached data if it exists (populated by calculate_smart_rent trigger)
            return cached.safmr_data;
        }

        // No HUD data available for this zip code
        // Return null - the UI will use smart estimate/comps instead
        console.log(`No HUD SAFMR data available for ${zipCode}`);
        return null;

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
        const result = await client.query(query, [id]);
        client.release();

        if (result.rows.length === 0) return null;

        const row = result.rows[0];
        const raw = row.raw_data || {};

        // Image Logic
        let images = [];
        if (raw.primary_photo) images.push(raw.primary_photo);
        if (raw.alt_photos) {
            const alts = Array.isArray(raw.alt_photos)
                ? raw.alt_photos
                : (typeof raw.alt_photos === 'string' ? raw.alt_photos.split(',') : []);
            images.push(...alts);
        }
        images = images.map(url => url.trim()).filter(url => url.length > 0);

        // Rent fallback - use national average by bedroom
        let rent = Number(row.estimated_rent);
        if (!rent || rent === 0) {
            const beds = Number(row.bedrooms) || 3;
            rent = getFallbackRent(Number(row.listing_price), beds);
        }

        // Sanitize Row Data
        const created_at = row.created_at instanceof Date ? row.created_at.toISOString() : (row.created_at || new Date().toISOString());

        return {
            ...row,
            created_at,
            listing_price: Number(row.listing_price) || 0,
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
        await client.query(
            `UPDATE listings 
             SET estimated_rent = $1, 
                 updated_at = NOW()
             WHERE id = $2`,
            [Math.round(rent), id]
        );
        client.release();
        return { success: true };
    } catch (error) {
        console.error('Failed to update rent:', error);
        return { success: false, error };
    }
}
