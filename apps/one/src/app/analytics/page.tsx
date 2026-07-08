import pool from '@/lib/db';
import { getMarketTrends } from '@/lib/fred';
import MarketTrends from '@/components/MarketTrends';
import PortfolioCharts from '@/components/PortfolioCharts';
import { TrendingUp, DollarSign, Home, PieChart as PieChartIcon } from 'lucide-react';

export const dynamic = 'force-dynamic';

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export default async function AnalyticsPage() {
    let properties: any[] = [];

    try {
        // Only the columns PortfolioCharts consumes — selecting raw_data
        // (full JSONB) for 500 rows was serialized into client props for
        // nothing. pool.query() checks a connection out and back in on its
        // own, so there is no client to leak on throw.
        const propResult = await pool.query(`
            SELECT
                id,
                address,
                COALESCE(price, (raw_data->>'list_price')::numeric) as listing_price,
                COALESCE(estimated_rent, (raw_data->>'estimated_rent')::numeric) as estimated_rent,
                listing_status
            FROM listings
            WHERE listing_type = 'for_sale' AND sale_type = 'standard'
            ORDER BY created_at DESC
            LIMIT 500
        `);
        properties = propResult.rows;
    } catch (error) {
        console.error('Database error:', error);
    }

    const total = properties.length;
    const totalPrice = properties.reduce((acc, p) => acc + (Number(p.listing_price) || 0), 0);
    const totalRent = properties.reduce((acc, p) => acc + (Number(p.estimated_rent) || 0), 0);

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

    const trendsData = await getMarketTrends();

    return (
        <div style={{ background: 'var(--ink)', color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>
            <div className="mx-auto max-w-7xl px-6 py-10">
                <header className="mb-8 flex items-center justify-between">
                    <div>
                        <h1 style={{ font: '400 var(--display-2)/1.1 var(--font-display)' }}>Market Analytics</h1>
                        <p className="mt-1 text-[14px]" style={{ color: 'var(--haze)' }}>Deep dive into market trends and portfolio metrics.</p>
                    </div>
                </header>

                {/* Macro Trends (FRED) */}
                <section className="mb-10">
                    <div className="mb-4 flex items-center gap-2">
                        <TrendingUp className="h-5 w-5" style={{ color: 'var(--pass-hi)' }} />
                        <h2 className="text-[18px] font-semibold">Macro Market Trends</h2>
                    </div>
                    <MarketTrends data={trendsData} />
                </section>

                {/* KPI Cards */}
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
                    <StatCard icon={<Home />} label="Total Properties" value={String(stats.totalProperties)} />
                    <StatCard icon={<DollarSign />} label="Avg Listing Price" value={stats.avgPrice > 0 ? usd0.format(stats.avgPrice) : '—'} />
                    <StatCard icon={<TrendingUp />} label="Avg Est. Rent" value={stats.avgRent > 0 ? usd0.format(stats.avgRent) : '—'} />
                    <StatCard icon={<PieChartIcon />} label="Avg Gross Yield" value={`${stats.avgYield.toFixed(2)}%`} pass />
                </div>

                {/* Portfolio Charts */}
                <PortfolioCharts properties={properties} stats={stats} />
            </div>
        </div>
    );
}

function StatCard({ icon, label, value, pass }: { icon: React.ReactNode; label: string; value: string; pass?: boolean }) {
    return (
        <div className="rounded-[var(--r-panel)] p-5" style={{ background: 'var(--ink-panel)', border: '1px solid var(--line)' }}>
            <div className="flex items-center gap-3">
                <div style={{ color: 'var(--haze)' }} className="h-5 w-5">{icon}</div>
                <div>
                    <p className="text-[12px] font-medium" style={{ color: 'var(--haze)' }}>{label}</p>
                    <p className="text-[22px] font-semibold" style={{ color: pass ? 'var(--pass-hi)' : 'var(--text)' }}>{value}</p>
                </div>
            </div>
        </div>
    );
}
