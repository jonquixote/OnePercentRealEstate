import pool from '@/lib/db';
import { getMarketTrends } from '@/lib/fred';
import MarketTrends from '@/components/MarketTrends';
import Header from '@/components/Header';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, DollarSign, Home, PieChart as PieChartIcon } from 'lucide-react';
import PortfolioCharts from '@/components/PortfolioCharts';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
    // Fetch data from PostgreSQL directly
    let properties: any[] = [];
    let benchmarks: any[] = [];

    try {
        const client = await pool.connect();

        // Fetch all properties
        const propResult = await client.query(`
            SELECT 
                id,
                address,
                COALESCE(price, (raw_data->>'list_price')::numeric) as listing_price,
                COALESCE(estimated_rent, (raw_data->>'estimated_rent')::numeric) as estimated_rent,
                raw_data
            FROM listings
            ORDER BY created_at DESC
            LIMIT 500
        `);
        properties = propResult.rows;

        // Fetch market benchmarks
        const benchResult = await client.query(`
            SELECT * FROM market_benchmarks LIMIT 100
        `);
        benchmarks = benchResult.rows;

        client.release();
    } catch (error) {
        console.error('Database error:', error);
    }

    // 2. Calc High Level Stats (Server Side is fine/fast)
    const total = properties.length;
    const totalPrice = properties.reduce((acc, p) => acc + (Number(p.listing_price) || 0), 0);
    const totalRent = properties.reduce((acc, p) => acc + (Number(p.estimated_rent) || 0), 0);

    // Simple Yield: (Annual Rent / Price) * 100 (Avg of yields)
    const totalYield = properties.reduce((acc, p) => {
        const price = Number(p.listing_price);
        const rent = Number(p.estimated_rent);
        if (price > 0 && rent > 0) {
            return acc + ((rent * 12) / price);
        }
        return acc;
    }, 0);

    const stats = {
        totalProperties: total,
        avgPrice: total > 0 ? totalPrice / total : 0,
        avgRent: total > 0 ? totalRent / total : 0,
        avgYield: total > 0 ? (totalYield / total) * 100 : 0
    };

    // Fetch FRED market trends
    const trendsData = await getMarketTrends();

    return (
        <div className="min-h-screen bg-gray-50 font-sans text-slate-900">
            <Header />
            <div className="p-8">
                <div className="mx-auto max-w-7xl">
                    <header className="mb-8 flex items-center justify-between">
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight text-gray-900">Market Analytics</h1>
                            <p className="text-gray-500">Deep dive into market trends and portfolio metrics.</p>
                        </div>
                        <Link href="/" className="text-sm font-medium text-blue-600 hover:text-blue-500">
                            &larr; Back to Dashboard
                        </Link>
                    </header>

                    {/* 1. Macro Trends (FRED) */}
                    <section className="mb-10">
                        <div className="mb-4 flex items-center gap-2">
                            <TrendingUp className="h-5 w-5 text-blue-600" />
                            <h2 className="text-xl font-semibold">Macro Market Trends</h2>
                        </div>
                        <MarketTrends data={trendsData} />
                    </section>

                    {/* 2. Portfolio KPI Cards */}
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Total Properties</CardTitle>
                                <Home className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{stats.totalProperties}</div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Avg Listing Price</CardTitle>
                                <DollarSign className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">${stats.avgPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Avg Est. Rent</CardTitle>
                                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">${stats.avgRent.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Avg Gross Yield</CardTitle>
                                <PieChartIcon className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold text-green-600">{stats.avgYield.toFixed(2)}%</div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* 3. Detailed Portfolio Charts (Client Component) */}
                    <PortfolioCharts
                        properties={properties}
                        benchmarks={benchmarks}
                        stats={stats}
                    />

                </div>
            </div>
        </div>
    );
}
