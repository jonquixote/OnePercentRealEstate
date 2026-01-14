
'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    ScatterChart, Scatter, ZAxis,
    PieChart, Pie, Cell, Legend
} from 'recharts';

interface PortfolioChartsProps {
    properties: any[];
    benchmarks: any[];
    stats: any;
}

export default function PortfolioCharts({ properties, benchmarks, stats }: PortfolioChartsProps) {
    const data = properties; // rename for convenience

    // Prepare Chart Data
    const priceDistribution = data.reduce((acc: any[], p: any) => {
        const range = Math.floor((p.listing_price || 0) / 50000) * 50000;
        const label = `$${range / 1000}k - $${(range + 50000) / 1000}k`;
        const existing = acc.find(i => i.name === label);
        if (existing) existing.count++;
        else acc.push({ name: label, count: 1, sortKey: range });
        return acc;
    }, []).sort((a: any, b: any) => a.sortKey - b.sortKey);

    const statusDistribution = data.reduce((acc: any[], p: any) => {
        const status = p.status || 'Unknown';
        const existing = acc.find(i => i.name === status);
        if (existing) existing.value++;
        else acc.push({ name: status, value: 1 });
        return acc;
    }, []);

    const rentVsPrice = data.map((p: any) => ({
        price: p.listing_price,
        rent: p.estimated_rent,
        address: p.address
    }));

    // Prepare Rent vs HUD Data
    const rentByZip = data.reduce((acc: any, p: any) => {
        const zip = p.address?.match(/\d{5}/)?.[0] || 'Unknown';
        if (!acc[zip]) acc[zip] = { count: 0, totalRent: 0 };
        acc[zip].count++;
        acc[zip].totalRent += (p.estimated_rent || 0);
        return acc;
    }, {});

    const rentVsHudData = Object.keys(rentByZip).map(zip => {
        const avgRent = rentByZip[zip].totalRent / rentByZip[zip].count;
        const benchmark = benchmarks.find((b: any) => b.zip_code === zip);
        const hudRent = benchmark ? benchmark.safmr_data['3br'] : 0;

        return {
            name: zip,
            "Avg Rent": Math.round(avgRent),
            "HUD FMR (3BR)": hudRent
        };
    }).filter(d => d["HUD FMR (3BR)"] > 0);

    // Prepare Deal Economics
    const avgRent = stats.avgRent;
    const avgPrice = stats.avgPrice;

    // Assumptions
    const vacancy = avgRent * 0.05;
    const maintenance = avgRent * 0.05;
    const management = avgRent * 0.10;
    const taxes = (avgPrice * 0.02) / 12;
    const insurance = (avgPrice * 0.005) / 12;
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

    // Ensure parents have sizes for ResponsiveContainer
    return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
            {/* Price Distribution */}
            <Card className="col-span-4">
                <CardHeader>
                    <CardTitle>Price Distribution</CardTitle>
                </CardHeader>
                <CardContent className="pl-2">
                    <div className="h-[300px] w-full min-h-[300px] min-w-0">
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
                    <div className="h-[300px] w-full min-h-[300px] min-w-0">
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
                    <div className="h-[400px] w-full min-h-[400px] min-w-0">
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
                    <div className="h-[300px] w-full min-h-[300px] min-w-0">
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
                    <div className="h-[300px] w-full min-h-[300px] min-w-0">
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
    );
}
