import { supabase } from '@/lib/supabase';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

// Generate static params for all known zip codes
export async function generateStaticParams() {
    const { data: benchmarks } = await supabase
        .from('market_benchmarks')
        .select('zip_code');

    return (benchmarks || []).map((b) => ({
        zipcode: b.zip_code,
    }));
}

export default async function MarketPage({ params }: { params: Promise<{ zipcode: string }> }) {
    const { zipcode } = await params;

    const { data: benchmark } = await supabase
        .from('market_benchmarks')
        .select('*')
        .eq('zip_code', zipcode)
        .single();

    if (!benchmark) {
        notFound();
    }

    const safmr = benchmark.safmr_data || {};
    const rent3br = safmr['3br'] || 0;

    return (
        <div className="min-h-screen bg-white">
            <header className="bg-gray-50 border-b border-gray-200">
                <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
                    <Link href="/" className="flex items-center text-sm font-medium text-blue-600 hover:text-blue-500 mb-4">
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to Home
                    </Link>
                    <h1 className="text-4xl font-extrabold tracking-tight text-gray-900">
                        Real Estate Investment Analysis for {zipcode}
                    </h1>
                    <p className="mt-2 text-lg text-gray-500">
                        Is {zipcode} a good place to invest? See the data.
                    </p>
                </div>
            </header>

            <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
                <div className="grid gap-8 md:grid-cols-2">
                    {/* Market Stats */}
                    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-8">
                        <h2 className="text-2xl font-bold text-gray-900 mb-6">Market Benchmarks</h2>
                        <div className="space-y-4">
                            <div className="flex justify-between border-b border-gray-100 pb-2">
                                <span className="text-gray-600">HUD Fair Market Rent (3BR)</span>
                                <span className="font-bold text-xl text-green-600">${rent3br}</span>
                            </div>
                            <div className="flex justify-between border-b border-gray-100 pb-2">
                                <span className="text-gray-600">Median Home Price</span>
                                <span className="font-bold text-xl text-gray-900">
                                    {benchmark.median_price ? `$${benchmark.median_price.toLocaleString()}` : 'N/A'}
                                </span>
                            </div>
                        </div>
                        <div className="mt-8">
                            <Link
                                href={`/search?location=${zipcode}`}
                                className="block w-full text-center rounded-md bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-700"
                            >
                                Find Deals in {zipcode}
                            </Link>
                        </div>
                    </div>

                    {/* SEO Content */}
                    <div className="prose prose-blue max-w-none">
                        <h3>Investing in {zipcode}</h3>
                        <p>
                            Real estate investors are increasingly looking at <strong>{zipcode}</strong> for cash flow opportunities.
                            With a HUD Fair Market Rent of <strong>${rent3br}</strong> for a 3-bedroom unit, this area offers potential for meeting the 1% Rule.
                        </p>
                        <p>
                            Our platform analyzes thousands of listings to find properties that generate positive cash flow.
                            Use our <strong>OnePercentRealEstate Dashboard</strong> to filter by Cap Rate, Cash-on-Cash Return, and Net Operating Income.
                        </p>
                        <h3>Why use the 1% Rule in {zipcode}?</h3>
                        <p>
                            The 1% rule suggests that the monthly rent should be at least 1% of the purchase price.
                            In {zipcode}, this means if you buy a property for $100,000, you should aim for $1,000 in monthly rent.
                        </p>
                    </div>
                </div>
            </main>
        </div>
    );
}
