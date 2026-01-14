import { createClient } from '@supabase/supabase-js';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, TrendingUp, Building, Wallet, MapPin } from 'lucide-react';
import { PropertyCard } from '@/components/ui/card';

// Force static generation for these pages
export const dynamic = 'force-static';
// Revalidate every 24 hours
export const revalidate = 86400;

function getSupabase() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
}

// 1. Generate Static Params: Build pages for all known zips at build time
export async function generateStaticParams() {
    const supabase = getSupabase();
    const { data: properties } = await supabase.from('properties').select('address');

    const zips = new Set<string>();
    if (properties) {
        properties.forEach(p => {
            const match = p.address.match(/\b\d{5}\b/);
            if (match) zips.add(match[0]);
        });
    }

    return Array.from(zips).map((zipcode) => ({
        zipcode: zipcode,
    }));
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
    const supabase = getSupabase();

    // Fetch properties in this zip
    // Note: Since address is unstructured, we use ILIKE. In a real app, storing zip_code column is better.
    const { data: properties } = await supabase
        .from('properties')
        .select('*')
        .ilike('address', `%${zipcode}%`)
        .order('created_at', { ascending: false });

    // Fetch market benchmarks if available
    const { data: benchmarks } = await supabase
        .from('market_benchmarks')
        .select('*')
        .eq('zip_code', zipcode)
        .single();

    const activeProperties = properties || [];
    const count = activeProperties.length;

    // Calculate Averages
    const avgPrice = count > 0
        ? activeProperties.reduce((acc, p) => acc + (p.listing_price || 0), 0) / count
        : 0;

    const avgRent = benchmarks?.safmr_data?.['2br'] || (avgPrice * 0.008); // Fallback

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
                    <p className="text-xl text-gray-300">Real estate investment usage data and active opportunities.</p>
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
                                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(avgRent)}
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
                                    {avgPrice > 0 ? ((avgRent * 12 / avgPrice) * 100).toFixed(2) : '0'}%
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
                        <Link href="/search" className="mt-4 inline-block text-emerald-600 font-medium hover:underline">
                            Run a search for {zipcode}
                        </Link>
                    </div>
                )}
            </div>
        </div>
    );
}
