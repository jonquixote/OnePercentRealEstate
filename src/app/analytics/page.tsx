'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, TrendingUp, DollarSign, Home, PieChart as PieChartIcon } from 'lucide-react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    ScatterChart, Scatter, ZAxis,
    PieChart, Pie, Cell, Legend
} from 'recharts';
import Link from 'next/link';

export default function AnalyticsPage() {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<any[]>([]);
    const [benchmarks, setBenchmarks] = useState<any[]>([]);
    const [stats, setStats] = useState({
        totalProperties: 0,
        avgPrice: 0,
        avgRent: 0,
        avgYield: 0
    });

    useEffect(() => {
        async function fetchData() {
            const { data: properties, error } = await supabase
                .from('properties')
                .select('*');

            const { data: marketData, error: marketError } = await supabase
                .from('market_benchmarks')
                .select('*');

            if (error || marketError) {
                console.error('Error fetching data:', error || marketError);
            } else {
                if (properties) setData(properties);
                if (marketData) setBenchmarks(marketData);

                // Calculate Stats
                const total = properties.length;
                const totalPrice = properties.reduce((acc, p) => acc + p.listing_price, 0);
                const totalRent = properties.reduce((acc, p) => acc + (p.estimated_rent || 0), 0);

                // Avg Yield (Gross Rent Multiplier-ish, but let's do Cap Rate approx)
                // Simple Yield = (Annual Rent / Price) * 100
                const totalYield = properties.reduce((acc, p) => {
                    if (p.listing_price > 0) {
                        return acc + ((p.estimated_rent * 12) / p.listing_price);
                    }
                    return acc;
                }, 0);

                setStats({
                    totalProperties: total,
                    avgPrice: total > 0 ? totalPrice / total : 0,
                    avgRent: total > 0 ? totalRent / total : 0,
                    avgYield: total > 0 ? (totalYield / total) * 100 : 0
                });
            }
            setLoading(false);
        }

        fetchData();
    }, []);

    // Prepare Chart Data
    const priceDistribution = data.reduce((acc: any[], p) => {
        const range = Math.floor(p.listing_price / 50000) * 50000;
        const label = `$${range / 1000}k - $${(range + 50000) / 1000}k`;
        const existing = acc.find(i => i.name === label);
        if (existing) existing.count++;
        else acc.push({ name: label, count: 1, sortKey: range });
        return acc;
    }, []).sort((a, b) => a.sortKey - b.sortKey);

    const statusDistribution = data.reduce((acc: any[], p) => {
        const existing = acc.find(i => i.name === p.status);
        if (existing) existing.value++;
        else acc.push({ name: p.status, value: 1 });
        return acc;
    }, []);

    const rentVsPrice = data.map(p => ({
        price: p.listing_price,
        rent: p.estimated_rent,
        address: p.address
    }));

    // Prepare Rent vs HUD Data
    // Group properties by Zip Code and calc avg rent
    const rentByZip = data.reduce((acc: any, p) => {
        const zip = p.address.match(/\d{5}/)?.[0] || 'Unknown';
        if (!acc[zip]) acc[zip] = { count: 0, totalRent: 0 };
        acc[zip].count++;
        acc[zip].totalRent += p.estimated_rent;
        return acc;
    }, {});

    const rentVsHudData = Object.keys(rentByZip).map(zip => {
        const avgRent = rentByZip[zip].totalRent / rentByZip[zip].count;
        const benchmark = benchmarks.find(b => b.zip_code === zip);
        // Assuming 3BR as standard comparison for now, or avg of all
        const hudRent = benchmark ? benchmark.safmr_data['3br'] : 0;

        return {
            name: zip,
            "Avg Rent": Math.round(avgRent),
            "HUD FMR (3BR)": hudRent
        };
    }).filter(d => d["HUD FMR (3BR)"] > 0); // Only show if we have benchmark data

    // Prepare Deal Economics (Waterfall-ish)
    // Avg Monthly Income -> Expenses -> Cash Flow
    const avgRent = stats.avgRent;
    const avgPrice = stats.avgPrice;
    // Assumptions
    const vacancy = avgRent * 0.05;
    const maintenance = avgRent * 0.05;
    const management = avgRent * 0.10;
    const taxes = (avgPrice * 0.02) / 12; // 2% rule of thumb
    const insurance = (avgPrice * 0.005) / 12; // 0.5% rule of thumb
    const totalExpenses = vacancy + maintenance + management + taxes + insurance;
    const cashFlow = avgRent - totalExpenses;

    const economicsData = [
        { name: 'Gross Rent', value: Math.round(avgRent), fill: '#4ade80' },
        { name: 'Vacancy', value: -Math.round(vacancy), fill: '#f87171' },
        { name: 'Maint/CapEx', value: -Math.round(maintenance), fill: '#f87171' },
        { name: 'Mgmt', value: -Math.round(management), fill: '#f87171' },
        { name: 'Taxes', value: -Math.round(taxes), fill: '#f87171' },
        { name: 'Insurance', value: -Math.round(insurance), fill: '#f87171' },
        { name: 'Net Cash Flow', value: Math.round(cashFlow), fill: '#60a5fa' },
    ];

    const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 p-8">
            <div className="mx-auto max-w-7xl">
                <header className="mb-8 flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-gray-900">Market Analytics</h1>
                        <p className="text-gray-500">Deep dive into your property portfolio metrics.</p>
                    </div>
                    <Link href="/" className="text-sm font-medium text-blue-600 hover:text-blue-500">
                        &larr; Back to Dashboard
                    </Link>
                </header>

                {/* KPI Cards */}
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

                {/* Charts */}
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">

                    {/* Price Distribution */}
                    <Card className="col-span-4">
                        <CardHeader>
                            <CardTitle>Price Distribution</CardTitle>
                        </CardHeader>
                        <CardContent className="pl-2">
                            <div className="h-[300px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={priceDistribution}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                                        <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}`} />
                                        <Tooltip />
                                        <Bar dataKey="count" fill="#000000" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Status Distribution */}
                    <Card className="col-span-3">
                        <CardHeader>
                            <CardTitle>Portfolio Status</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[300px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={statusDistribution}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={60}
                                            outerRadius={80}
                                            fill="#8884d8"
                                            paddingAngle={5}
                                            dataKey="value"
                                        >
                                            {statusDistribution.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip />
                                        <Legend />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Rent vs Price Scatter */}
                    <Card className="col-span-7">
                        <CardHeader>
                            <CardTitle>Rent vs. Price Correlation</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[400px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                                        <CartesianGrid />
                                        <XAxis type="number" dataKey="price" name="Price" unit="$" />
                                        <YAxis type="number" dataKey="rent" name="Rent" unit="$" />
                                        <ZAxis type="category" dataKey="address" name="Address" />
                                        <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                                        <Scatter name="Properties" data={rentVsPrice} fill="#8884d8" />
                                    </ScatterChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Rent vs HUD Benchmark */}
                    <Card className="col-span-4">
                        <CardHeader>
                            <CardTitle>Rent vs. HUD Fair Market Rent (3BR)</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[300px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={rentVsHudData}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="name" />
                                        <YAxis />
                                        <Tooltip />
                                        <Legend />
                                        <Bar dataKey="Avg Rent" fill="#8884d8" />
                                        <Bar dataKey="HUD FMR (3BR)" fill="#82ca9d" />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Deal Economics Waterfall */}
                    <Card className="col-span-3">
                        <CardHeader>
                            <CardTitle>Avg Deal Economics (Monthly)</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[300px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={economicsData}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="name" fontSize={10} interval={0} />
                                        <YAxis />
                                        <Tooltip />
                                        <Bar dataKey="value">
                                            {economicsData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={entry.fill} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>

                </div>
            </div>
        </div>
    );
}
