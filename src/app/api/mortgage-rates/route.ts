import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const FRED_API_KEY = '95f42f356f5131f13257eac54897e96a';
const SERIES_ID = 'MORTGAGE30US';
const CACHE_KEY = 'GLOBAL_MORTGAGE_RATE';
const CACHE_DURATION_HOURS = 24;



export async function GET() {
    try {
        // Initialize Supabase Admin Client (bypasses RLS)
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );
        // 1. Check Cache
        const { data: cachedData, error: cacheError } = await supabase
            .from('market_benchmarks')
            .select('*')
            .eq('zip_code', CACHE_KEY)
            .single();

        if (cachedData && !cacheError) {
            const lastUpdated = new Date(cachedData.last_updated);
            const now = new Date();
            const hoursDiff = (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60);

            if (hoursDiff < CACHE_DURATION_HOURS && cachedData.safmr_data?.rate) {
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
        const { error: upsertError } = await supabase
            .from('market_benchmarks')
            .upsert({
                zip_code: CACHE_KEY,
                safmr_data: { rate: rate },
                last_updated: new Date().toISOString()
            });

        if (upsertError) {
            console.error("Failed to update cache:", upsertError);
        }

        return NextResponse.json({ rate: rate, cached: false });

    } catch (error) {
        console.error('Error fetching mortgage rate:', error);
        // Fallback to a reasonable default if API fails
        return NextResponse.json({ rate: 6.5, error: 'Failed to fetch live rate' });
    }
}
