import pool from '@/lib/db';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, TrendingUp, Building, Wallet, MapPin } from 'lucide-react';
import { PropertyCard } from '@/components/ui/card';

// Force static generation for these pages
export const dynamic = 'force-static';
// Revalidate every 24 hours
export const revalidate = 86400;

// 1. Generate Static Params: Build pages for all known zips at build time
export async function generateStaticParams() {
    try {
        const client = await pool.connect();
        const result = await client.query(`
            SELECT DISTINCT raw_data->>'zip_code' as zip_code 
            FROM listings 
            WHERE raw_data->>'zip_code' IS NOT NULL
            LIMIT 500
        `);
        client.release();

        return result.rows
            .filter(row => row.zip_code && /^\d{5}$/.test(row.zip_code))
            .map(row => ({ zipcode: row.zip_code }));
    } catch (error) {
        console.error('Failed to generate static params:', error);
        return [];
    }
}

// 2. Generate Metadata for SEO
export async function generateMetadata({ params }: { params: Promise<{ zipcode: string }> }) {
    const { zipcode } = await params;
    return {
        title: `Real Estate Investment in ${zipcode} | Market Analysis`,
        description: `Analyze cap rates, rent-to-price ratios, and investment opportunities in ${zipcode}. See average prices and rental yields on OnePercentRealEstate.`,
    };
}

// 3. Page Component
export default async function MarketPage({ params }: { params: Promise<{ zipcode: string }> }) {
    const { zipcode } = await params;

    let properties: any[] = [];
    let benchmarks: any = null;

    try {
        const client = await pool.connect();

        // Fetch properties in this zip
        const propResult = await client.query(`
            SELECT 
                id,
                address,
                COALESCE(price, (raw_data->>'list_price')::numeric) as listing_price,
                COALESCE(estimated_rent, (raw_data->>'estimated_rent')::numeric) as estimated_rent,
                raw_data,
                created_at
            FROM listings 
            WHERE raw_data->>'zip_code' = $1
            ORDER BY created_at DESC
            LIMIT 100
        `, [zipcode]);
        properties = propResult.rows;

        // Fetch market benchmarks if available
        const benchResult = await client.query(`
            SELECT safmr_data FROM market_benchmarks WHERE zip_code = $1
        `, [zipcode]);
        benchmarks = benchResult.rows[0] || null;

        client.release();
    } catch (error) {
        console.error('Database error:', error);
    }

    const activeProperties = properties || [];
    const count = activeProperties.length;

    // Calculate Averages
    const avgPrice = count > 0
        ? activeProperties.reduce((acc, p) => acc + (Number(p.listing_price) || 0), 0) / count
        : 0;

    // Use SAFMR data if available, otherwise check if we have enough estimated_rent data
    const validRents = activeProperties.filter(p => p.estimated_rent && Number(p.estimated_rent) > 0);
    const rentCount = validRents.length;

    const avgRent = benchmarks?.safmr_data?.['2br'] ||
        (rentCount > 0 ? validRents.reduce((acc, p) => acc + (Number(p.estimated_rent) || 0), 0) / rentCount : 0);

    if (count === 0 && !benchmarks) {
        return notFound();
    }

    return (
        <div className="min-h-screen bg-gray-50 font-sans text-slate-900">
            <div className="bg-slate-900 text-white py-12">
                <div className="mx-auto max-w-7xl px-8">
                    <Link href="/" className="inline-flex items-center text-sm text-gray-400 hover:text-white mb-6 transition-colors">
                        <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
                    </Link>
                    <h1 className="text-4xl font-bold mb-4">Market Analysis: <span className="text-emerald-400">{zipcode}</span></h1>
                    <p className="text-xl text-gray-300">Real estate investment data and active opportunities.</p>
                </div>
            </div>

            <div className="mx-auto max-w-7xl px-8 py-12">
                {/* Stats Grid */}
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-3 mb-12">
                    <div className="bg-white overflow-hidden rounded-xl shadow-sm border border-gray-100 p-6">
                        <div className="flex items-center">
                            <div className="p-3 rounded-full bg-blue-100 text-blue-600">
                                <Building className="h-6 w-6" />
                            </div>
                            <div className="ml-4">
                                <p className="text-sm font-medium text-gray-500">Average List Price</p>
                                <p className="text-2xl font-bold text-gray-900">
                                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(avgPrice)}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white overflow-hidden rounded-xl shadow-sm border border-gray-100 p-6">
                        <div className="flex items-center">
                            <div className="p-3 rounded-full bg-emerald-100 text-emerald-600">
                                <Wallet className="h-6 w-6" />
                            </div>
                            <div className="ml-4">
                                <p className="text-sm font-medium text-gray-500">Average 2BR Rent</p>
                                <p className="text-2xl font-bold text-gray-900">
                                    {avgRent > 0
                                        ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(avgRent)
                                        : <span className="text-gray-400 text-lg italic">Calculating...</span>
                                    }
                                </p>
                                <span className="text-xs text-gray-400">HUD FMR / Est.</span>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white overflow-hidden rounded-xl shadow-sm border border-gray-100 p-6">
                        <div className="flex items-center">
                            <div className="p-3 rounded-full bg-purple-100 text-purple-600">
                                <TrendingUp className="h-6 w-6" />
                            </div>
                            <div className="ml-4">
                                <p className="text-sm font-medium text-gray-500">Est. Gross Yield</p>
                                <p className="text-2xl font-bold text-gray-900">
                                    {avgPrice > 0 && avgRent > 0 ? ((avgRent * 12 / avgPrice) * 100).toFixed(2) + '%' : '-'}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Properties Grid */}
                <h2 className="text-2xl font-bold mb-6 flex items-center">
                    <MapPin className="mr-2 h-6 w-6 text-slate-500" />
                    Active Opportunities in {zipcode}
                </h2>

                {count > 0 ? (
                    <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
                        {activeProperties.map((property) => (
                            <PropertyCard key={property.id} property={property} />
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-12 bg-white rounded-xl border border-dashed border-gray-300">
                        <p className="text-gray-500">No active properties found in this market currently.</p>
                        <Link href="/" className="mt-4 inline-block text-emerald-600 font-medium hover:underline">
                            Back to Dashboard
                        </Link>
                    </div>
                )}
            </div>
        </div>
    );
}
