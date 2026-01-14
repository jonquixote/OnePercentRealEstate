
import { cache } from 'react';

const FRED_API_KEY = process.env.FRED_API_KEY;
const BASE_URL = 'https://api.stlouisfed.org/fred/series/observations';

export interface FredDataPoint {
    date: string;
    value: number;
}

export interface MarketTrendData {
    mortgageRates: FredDataPoint[];
    homePriceIndex: FredDataPoint[];
}

async function fetchFredSeries(seriesId: string, limit = 24): Promise<FredDataPoint[]> {
    if (!FRED_API_KEY) {
        console.error("FRED_API_KEY is missing");
        return [];
    }

    try {
        // observation_start could be calculated to fetch last N years, but 'limit' & sort_order is easier for recent data
        // We want the last 2 years roughly. Monthly data = 24 points. Weekly data = 104 points.
        // Let's just fetch by count for simplicity, or we can set a start date.

        // Using limit and sort_order=desc to get most recent, then reverse for chart
        const params = new URLSearchParams({
            series_id: seriesId,
            api_key: FRED_API_KEY,
            file_type: 'json',
            sort_order: 'desc',
            limit: limit.toString(),
            // frequency: 'm' // Optional: force monthly if needed
        });

        const res = await fetch(`${BASE_URL}?${params.toString()}`, {
            next: { revalidate: 3600 * 24 } // Cache for 24 hours
        });

        if (!res.ok) {
            console.error(`FRED API Error for ${seriesId}: ${res.status} ${res.statusText}`);
            return [];
        }

        const data = await res.json();
        if (!data.observations) return [];

        const points = data.observations.map((obs: any) => ({
            date: obs.date,
            value: parseFloat(obs.value)
        })).filter((p: any) => !isNaN(p.value));

        // Return chronological order
        return points.reverse();
    } catch (error) {
        console.error(`Error fetching FRED series ${seriesId}:`, error);
        return [];
    }
}

export const getMarketTrends = cache(async (): Promise<MarketTrendData> => {
    // MORTGAGE30US: 30-Year Fixed Rate Mortgage Average (Weekly)
    // CSUSHPINSA: S&P/Case-Shiller U.S. National Home Price Index (Monthly)

    const [mortgageRates, hpi] = await Promise.all([
        fetchFredSeries('MORTGAGE30US', 52), // Last year of weekly data
        fetchFredSeries('CSUSHPINSA', 24) // Last 2 years of monthly data
    ]);

    return {
        mortgageRates,
        homePriceIndex: hpi
    };
});
