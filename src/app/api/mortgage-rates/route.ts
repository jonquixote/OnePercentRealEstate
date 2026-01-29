import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

const FRED_API_KEY = process.env.FRED_API_KEY || '95f42f356f5131f13257eac54897e96a';
const SERIES_ID = 'MORTGAGE30US';
const CACHE_KEY = 'GLOBAL_MORTGAGE_RATE';
const CACHE_DURATION_HOURS = 24;

export async function GET() {
    try {
        const client = await pool.connect();

        // 1. Check Cache
        const cacheResult = await client.query(
            'SELECT safmr_data, last_updated FROM market_benchmarks WHERE zip_code = $1',
            [CACHE_KEY]
        );

        if (cacheResult.rows.length > 0) {
            const cachedData = cacheResult.rows[0];
            const lastUpdated = new Date(cachedData.last_updated);
            const now = new Date();
            const hoursDiff = (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60);

            if (hoursDiff < CACHE_DURATION_HOURS && cachedData.safmr_data?.rate) {
                client.release();
                console.log("Returning cached mortgage rate");
                return NextResponse.json({ rate: cachedData.safmr_data.rate, cached: true });
            }
        }

        // 2. Fetch from FRED
        console.log("Fetching fresh mortgage rate from FRED...");
        const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${SERIES_ID}&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc&limit=1`;

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`FRED API error: ${response.statusText}`);
        }

        const data = await response.json();
        const rate = parseFloat(data.observations?.[0]?.value);

        if (!rate) {
            throw new Error('No rate data found');
        }

        // 3. Update Cache
        await client.query(`
            INSERT INTO market_benchmarks (zip_code, safmr_data, last_updated) 
            VALUES ($1, $2, NOW())
            ON CONFLICT (zip_code) DO UPDATE SET 
                safmr_data = $2,
                last_updated = NOW()
        `, [CACHE_KEY, JSON.stringify({ rate: rate })]);

        client.release();

        return NextResponse.json({ rate: rate, cached: false });

    } catch (error) {
        console.error('Error fetching mortgage rate:', error);
        // Fallback to a reasonable default if API fails
        return NextResponse.json({ rate: 6.5, error: 'Failed to fetch live rate' });
    }
}
