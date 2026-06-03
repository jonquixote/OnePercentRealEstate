'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';
import { Loader2, Search as SearchIcon } from 'lucide-react';
import Header from '@/components/Header';
import { useRouter } from 'next/navigation';

export default function SearchPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const [formData, setFormData] = useState({
        location: '',
        minPrice: '',
        maxPrice: '',
        beds: '',
        baths: '',
        limit: '10',
        site_name: '',
        listing_type: 'for_sale',
        past_days: '30'
    });

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setLogs(['Starting scrape job...', `Target: ${formData.location}`]);

        try {
            const response = await fetch('/api/scrape', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    location: formData.location,
                    minPrice: formData.minPrice ? Number(formData.minPrice) : undefined,
                    maxPrice: formData.maxPrice ? Number(formData.maxPrice) : undefined,
                    beds: formData.beds ? Number(formData.beds) : undefined,
                    baths: formData.baths ? Number(formData.baths) : undefined,
                    limit: Number(formData.limit),
                    site_name: formData.site_name || undefined,
                    listing_type: formData.listing_type,
                    past_days: Number(formData.past_days)
                })
            });

            const data = await response.json();

            if (response.ok) {
                setLogs(prev => [...prev, 'Scrape completed successfully!', `Found: ${data.found}`, `Inserted: ${data.inserted}`]);
                if (data.inserted > 0) {
                    setTimeout(() => router.push('/'), 2000); // Redirect to dashboard
                }
            } else {
                setLogs(prev => [...prev, `Error: ${data.error}`, data.details || '']);
            }

        } catch (error) {
            setLogs(prev => [...prev, 'Network error occurred.']);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50">
            <Header />
            <div className="p-8">
                <div className="mx-auto max-w-3xl">
                    <div className="mb-8">
                        <h1 className="text-3xl font-bold tracking-tight text-gray-900">Acquire New Data</h1>
                        <p className="text-gray-500">Search and import properties from the live market.</p>
                    </div>

                    <Card>
                        <CardHeader>
                            <CardTitle>Search Parameters</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div>
                                    <label className="mb-1 block text-sm font-medium text-gray-700">Location (Zip Code or City, State) *</label>
                                    <input
                                        type="text"
                                        name="location"
                                        required
                                        placeholder="e.g. 44111 or Cleveland, OH"
                                        className="w-full rounded-md border border-gray-300 p-2 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        value={formData.location}
                                        onChange={handleChange}
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="mb-1 block text-sm font-medium text-gray-700">Min Price</label>
                                        <input
                                            type="number"
                                            name="minPrice"
                                            placeholder="0"
                                            className="w-full rounded-md border border-gray-300 p-2 text-gray-900"
                                            value={formData.minPrice}
                                            onChange={handleChange}
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-sm font-medium text-gray-700">Max Price</label>
                                        <input
                                            type="number"
                                            name="maxPrice"
                                            placeholder="500000"
                                            className="w-full rounded-md border border-gray-300 p-2 text-gray-900"
                                            value={formData.maxPrice}
                                            onChange={handleChange}
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-3 gap-4">
                                    <div>
                                        <label className="mb-1 block text-sm font-medium text-gray-700">Min Beds</label>
                                        <input
                                            type="number"
                                            name="beds"
                                            placeholder="2"
                                            className="w-full rounded-md border border-gray-300 p-2 text-gray-900"
                                            value={formData.beds}
                                            onChange={handleChange}
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-sm font-medium text-gray-700">Min Baths</label>
                                        <input
                                            type="number"
                                            name="baths"
                                            placeholder="1"
                                            className="w-full rounded-md border border-gray-300 p-2 text-gray-900"
                                            value={formData.baths}
                                            onChange={handleChange}
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-sm font-medium text-gray-700">Limit</label>
                                        <select
                                            name="limit"
                                            className="w-full rounded-md border border-gray-300 p-2 text-gray-900"
                                            value={formData.limit}
                                            onChange={handleChange}
                                        >
                                            <option value="10">10</option>
                                            <option value="25">25</option>
                                            <option value="50">50</option>
                                            <option value="100">100</option>
                                            <option value="-1">Unlimited</option>
                                        </select>
                                    </div>
                                </div>

                                <div className="grid grid-cols-3 gap-4">
                                    <div>
                                        <label className="mb-1 block text-sm font-medium text-gray-700">Source</label>
                                        <select
                                            name="site_name"
                                            className="w-full rounded-md border border-gray-300 p-2 text-gray-900"
                                            value={formData.site_name}
                                            onChange={handleChange}
                                        >
                                            <option value="">All Sources</option>
                                            <option value="realtor.com">Realtor.com</option>
                                            <option value="zillow">Zillow</option>
                                            <option value="redfin">Redfin</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-sm font-medium text-gray-700">Listing Type</label>
                                        <select
                                            name="listing_type"
                                            className="w-full rounded-md border border-gray-300 p-2 text-gray-900"
                                            value={formData.listing_type}
                                            onChange={handleChange}
                                        >
                                            <option value="for_sale">For Sale</option>
                                            <option value="for_rent">For Rent</option>
                                            <option value="sold">Sold</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-sm font-medium text-gray-700">Past Days</label>
                                        <input
                                            type="number"
                                            name="past_days"
                                            placeholder="30"
                                            className="w-full rounded-md border border-gray-300 p-2 text-gray-900"
                                            value={formData.past_days}
                                            onChange={handleChange}
                                        />
                                    </div>
                                </div>

                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="flex w-full items-center justify-center rounded-md bg-black px-4 py-2 font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                                >
                                    {loading ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            Scraping Market Data...
                                        </>
                                    ) : (
                                        <>
                                            <SearchIcon className="mr-2 h-4 w-4" />
                                            Search & Import
                                        </>
                                    )}
                                </button>
                            </form>
                        </CardContent>
                    </Card>

                    {logs.length > 0 && (
                        <div className="mt-6 rounded-lg bg-black p-4 font-mono text-sm text-green-400">
                            {logs.map((log, i) => (
                                <div key={i}>&gt; {log}</div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>

    );
}
