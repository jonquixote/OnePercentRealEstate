import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getMarketTrends } from '@/lib/fred';
import MarketTrends from '@/components/MarketTrends';
import Header from '@/components/Header';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, TrendingUp, DollarSign, Home, PieChart as PieChartIcon } from 'lucide-react';
import PortfolioCharts from '@/components/PortfolioCharts'; // Default export we'll need to create or keep charts inline if they are client side?
// Actually, Recharts MUST be client side.
// So we need to splitting this:
// 1. Page (Server) -> Fetches Data
// 2. MarketTrends (Client) -> Renders FRED charts
// 3. PortfolioCharts (Client) -> Renders the existing charts (Price Dist, Pie, Scatter, etc.)

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
    const supabase = await createClient(); // Await strictly needed? Usually yes for cookie helpers
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        redirect('/login');
    }

    // 1. Fetch Data Parallel
    const [trendsData, benchmarksResult, propertiesResult] = await Promise.all([
        getMarketTrends(),
        supabase.from('market_benchmarks').select('*'),
        supabase.from('properties').select('*').eq('user_id', user.id)
    ]);

    const benchmarks = benchmarksResult.data || [];
    const properties = propertiesResult.data || [];

    // 2. Calc High Level Stats (Server Side is fine/fast)
    const total = properties.length;
    const totalPrice = properties.reduce((acc, p) => acc + (p.listing_price || 0), 0);
    const totalRent = properties.reduce((acc, p) => acc + (p.estimated_rent || 0), 0);

    // Simple Yield: (Annual Rent / Price) * 100 (Avg of yields)
    const totalYield = properties.reduce((acc, p) => {
        if (p.listing_price > 0) {
            return acc + ((p.estimated_rent * 12) / p.listing_price);
        }
        return acc;
    }, 0);

    const stats = {
        totalProperties: total,
        avgPrice: total > 0 ? totalPrice / total : 0,
        avgRent: total > 0 ? totalRent / total : 0,
        avgYield: total > 0 ? (totalYield / total) * 100 : 0
    };

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
                    {/* We need to pass data to a client component because Recharts uses context/dom */}
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

