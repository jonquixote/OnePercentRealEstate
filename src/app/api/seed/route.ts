import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const location = searchParams.get('location') || '10001';
        const listingType = searchParams.get('type') || 'for_sale';

        // 1. Call Scraper Service
        // In Docker, the scraper service is at "http://scraper:8000"
        const scraperUrl = process.env.SCRAPER_URL || 'http://scraper:8000/scrape';
        console.log(`Seeding data from ${scraperUrl} for ${location}...`);

        const scraperResponse = await fetch(scraperUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                location: location,
                listing_type: listingType,
            }),
        });

        if (!scraperResponse.ok) {
            throw new Error(`Scraper failed: ${scraperResponse.statusText}`);
        }

        const responseText = await scraperResponse.text();
        console.log('Scraper raw response:', responseText.substring(0, 500)); // Log first 500 chars

        let properties;
        try {
            const json = JSON.parse(responseText);
            if (Array.isArray(json)) {
                properties = json;
            } else if (json.properties && Array.isArray(json.properties)) {
                properties = json.properties;
            } else if (json.results && Array.isArray(json.results)) {
                properties = json.results;
            } else {
                throw new Error('Response is not an array and does not contain "properties" array.');
            }
        } catch (e: any) {
            throw new Error('Failed to parse scraper response as JSON: ' + e.message + '. Raw: ' + responseText.substring(0, 200));
        }

        if (!Array.isArray(properties)) {
            console.error('Scraper response validation failed:', properties);
            throw new Error('Scraper response is not an array. Received type: ' + typeof properties);
        }

        console.log(`Fetched ${properties.length} properties.`);
        if (properties.length > 0) {
            console.log('First property keys:', Object.keys(properties[0]));
            console.log('First property sample:', JSON.stringify(properties[0]));
        }
        console.log('Inserting into DB...');

        // 2. Insert into Postgres
        const client = await pool.connect();
        let insertedCount = 0;

        try {
            await client.query('BEGIN');

            for (const p of properties) {
                // Prepare values
                const address = p.address || p.formatted_address || 'Unknown Address';
                const price = p.list_price || null;
                const beds = p.beds || null;
                const baths = p.full_baths || null; // HomeHarvest uses full_baths
                const sqft = p.sqft || null;
                const lat = p.latitude || null;
                const lon = p.longitude || null;
                const status = 'FOR_SALE'; // Default since we scraped for_sale
                const listing_type = 'for_sale';
                const raw_data = JSON.stringify(p);
                const url = p.property_url || p.url || null;

                // DEBUG LOG
                console.log(`Preparing insert for ${address}: Price=${price}, Beds=${beds}, Baths=${baths}, Lat=${lat}, Lon=${lon}`);


                // Upsert query
                const query = `
          INSERT INTO listings (
            address, 
            price, 
            bedrooms, 
            bathrooms, 
            sqft, 
            latitude, 
            longitude, 
            listing_status, 
            listing_type, 
            raw_data,
            url,
            property_url,
            listing_date
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
          ON CONFLICT (address, listing_type, listing_date) 
          DO UPDATE SET
            price = EXCLUDED.price,
            raw_data = EXCLUDED.raw_data,
            updated_at = NOW();
        `;

                await client.query(query, [
                    address, price, beds, baths, sqft, lat, lon, status, listing_type, raw_data, url, url
                ]);
                insertedCount++;
            }

            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }

        return NextResponse.json({
            success: true,
            count: insertedCount,
            message: `Successfully seeded ${insertedCount} properties for ${location}`,
            debug_first_property: properties.length > 0 ? properties[0] : null
        });

    } catch (error: any) {
        console.error('Seed error:', error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}
