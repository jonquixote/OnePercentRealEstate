'use client';

import { useEffect, useState, use } from 'react';
import { Loader2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

interface Property {
    id: string;
    address: string;
    listing_price: number;
    estimated_rent: number;
    financial_snapshot: any;
    status: string;
    images: string[];
    raw_data: any;
}

export default function ComparePage({ searchParams }: { searchParams: Promise<{ ids: string }> }) {
    const params = use(searchParams);
    const [loading, setLoading] = useState(true);
    const [properties, setProperties] = useState<Property[]>([]);

    useEffect(() => {
        async function fetchProperties() {
            if (!params.ids) {
                setLoading(false);
                return;
            }

            const ids = params.ids.split(',');

            try {
                // Fetch properties via API endpoint
                const response = await fetch(`/api/properties?ids=${ids.join(',')}`);
                if (response.ok) {
                    const data = await response.json();
                    setProperties(data || []);
                }
            } catch (error) {
                console.error('Error fetching properties:', error);
            }
            setLoading(false);
        }

        fetchProperties();
    }, [params.ids]);

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        );
    }

    if (properties.length === 0) {
        return (
            <div className="flex h-screen flex-col items-center justify-center gap-4">
                <p className="text-gray-500">No properties selected for comparison.</p>
                <Link href="/" className="text-blue-600 hover:underline">
                    Return to Dashboard
                </Link>
            </div>
        );
    }

    // Helper to format currency
    const formatCurrency = (val: number) =>
        new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);

    // Helper to format percent
    const formatPercent = (val: number) =>
        `${(val * 100).toFixed(2)}%`;

    return (
        <div className="min-h-screen bg-gray-50 p-8">
            <div className="mx-auto max-w-7xl">
                <header className="mb-8 flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-gray-900">Property Comparison</h1>
                        <p className="text-gray-500">Side-by-side analysis of selected opportunities.</p>
                    </div>
                    <Link href="/" className="flex items-center text-sm font-medium text-blue-600 hover:text-blue-500">
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to Dashboard
                    </Link>
                </header>

                <div className="overflow-x-auto pb-8">
                    <table className="w-full min-w-[800px] border-collapse bg-white shadow-sm rounded-lg overflow-hidden">
                        <thead>
                            <tr>
                                <th className="bg-gray-100 p-4 text-left text-sm font-semibold text-gray-600 w-48">Feature</th>
                                {properties.map(p => (
                                    <th key={p.id} className="p-4 text-left min-w-[250px] border-l border-gray-100">
                                        <div className="space-y-2">
                                            {p.images && p.images.length > 0 ? (
                                                <img src={p.images[0]} alt={p.address} className="h-32 w-full object-cover rounded-md" />
                                            ) : (
                                                <div className="h-32 w-full bg-gray-200 rounded-md flex items-center justify-center text-gray-400">No Image</div>
                                            )}
                                            <Link href={`/property/${p.id}`} className="block text-lg font-bold text-gray-900 hover:text-blue-600 line-clamp-2">
                                                {p.address}
                                            </Link>
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {/* Financials Section */}
                            <tr className="bg-gray-50">
                                <td colSpan={properties.length + 1} className="p-2 px-4 text-xs font-bold uppercase tracking-wider text-gray-500">Financials</td>
                            </tr>
                            <tr>
                                <td className="p-4 font-medium text-gray-700">Listing Price</td>
                                {properties.map(p => (
                                    <td key={p.id} className="p-4 border-l border-gray-100 font-semibold">{formatCurrency(p.listing_price)}</td>
                                ))}
                            </tr>
                            <tr>
                                <td className="p-4 font-medium text-gray-700">Est. Rent</td>
                                {properties.map(p => (
                                    <td key={p.id} className="p-4 border-l border-gray-100">{formatCurrency(p.estimated_rent)}</td>
                                ))}
                            </tr>
                            <tr>
                                <td className="p-4 font-medium text-gray-700">1% Rule Ratio</td>
                                {properties.map(p => {
                                    const ratio = (p.estimated_rent / p.listing_price);
                                    return (
                                        <td key={p.id} className={`p-4 border-l border-gray-100 font-bold ${ratio >= 0.01 ? 'text-green-600' : 'text-yellow-600'}`}>
                                            {formatPercent(ratio)}
                                        </td>
                                    );
                                })}
                            </tr>
                            <tr>
                                <td className="p-4 font-medium text-gray-700">Gross Yield</td>
                                {properties.map(p => {
                                    const yieldVal = (p.estimated_rent * 12) / p.listing_price;
                                    return (
                                        <td key={p.id} className="p-4 border-l border-gray-100">{formatPercent(yieldVal)}</td>
                                    )
                                })}
                            </tr>

                            {/* Specs Section */}
                            <tr className="bg-gray-50">
                                <td colSpan={properties.length + 1} className="p-2 px-4 text-xs font-bold uppercase tracking-wider text-gray-500">Property Specs</td>
                            </tr>
                            <tr>
                                <td className="p-4 font-medium text-gray-700">Bedrooms</td>
                                {properties.map(p => (
                                    <td key={p.id} className="p-4 border-l border-gray-100">{p.financial_snapshot?.bedrooms || '-'}</td>
                                ))}
                            </tr>
                            <tr>
                                <td className="p-4 font-medium text-gray-700">Bathrooms</td>
                                {properties.map(p => (
                                    <td key={p.id} className="p-4 border-l border-gray-100">{p.financial_snapshot?.bathrooms || '-'}</td>
                                ))}
                            </tr>
                            <tr>
                                <td className="p-4 font-medium text-gray-700">Sqft</td>
                                {properties.map(p => (
                                    <td key={p.id} className="p-4 border-l border-gray-100">{p.financial_snapshot?.sqft?.toLocaleString() || '-'}</td>
                                ))}
                            </tr>
                            <tr>
                                <td className="p-4 font-medium text-gray-700">Year Built</td>
                                {properties.map(p => (
                                    <td key={p.id} className="p-4 border-l border-gray-100">{p.financial_snapshot?.year_built || '-'}</td>
                                ))}
                            </tr>

                            {/* Raw Data Section */}
                            <tr className="bg-gray-50">
                                <td colSpan={properties.length + 1} className="p-2 px-4 text-xs font-bold uppercase tracking-wider text-gray-500">Additional Data</td>
                            </tr>
                            <tr>
                                <td className="p-4 font-medium text-gray-700">HOA Fee</td>
                                {properties.map(p => (
                                    <td key={p.id} className="p-4 border-l border-gray-100">{p.raw_data?.hoa_fee ? formatCurrency(p.raw_data.hoa_fee) : 'N/A'}</td>
                                ))}
                            </tr>
                            <tr>
                                <td className="p-4 font-medium text-gray-700">Status</td>
                                {properties.map(p => (
                                    <td key={p.id} className="p-4 border-l border-gray-100 capitalize">{(p.status || 'active').replace('_', ' ')}</td>
                                ))}
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
