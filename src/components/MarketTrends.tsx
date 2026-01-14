
'use client';

import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MarketTrendData } from '@/lib/fred';

function formatDate(dateStr: string) {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getFullYear().toString().slice(2)}`;
}

export default function MarketTrends({ data }: { data: MarketTrendData }) {
    const currentRate = data.mortgageRates[data.mortgageRates.length - 1]?.value;
    const prevRate = data.mortgageRates[data.mortgageRates.length - 2]?.value;
    const rateChange = currentRate && prevRate ? currentRate - prevRate : 0;

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            {/* 1. Mortgage Rates Chart */}
            <Card>
                <CardHeader className="pb-2">
                    <div className="flex justify-between items-start">
                        <div>
                            <CardTitle className="text-lg">30-Year Mortgage Rates</CardTitle>
                            <CardDescription>Weekly Average in the United States</CardDescription>
                        </div>
                        {currentRate && (
                            <div className="text-right">
                                <div className="text-2xl font-bold">{currentRate}%</div>
                                <Badge variant={rateChange > 0 ? "destructive" : "default"} className={rateChange > 0 ? "bg-red-500" : "bg-green-500"}>
                                    {rateChange > 0 ? "+" : ""}{rateChange.toFixed(2)}%
                                </Badge>
                            </div>
                        )}
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="h-[200px] w-full min-w-0">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={data.mortgageRates}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                                <XAxis
                                    dataKey="date"
                                    tickFormatter={formatDate}
                                    stroke="#9CA3AF"
                                    fontSize={12}
                                    minTickGap={30}
                                />
                                <YAxis
                                    domain={['auto', 'auto']}
                                    stroke="#9CA3AF"
                                    fontSize={12}
                                    tickFormatter={(val) => `${val}%`}
                                />
                                <Tooltip
                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    labelFormatter={(label) => new Date(label).toLocaleDateString()}
                                    formatter={(value: number) => [`${value}%`, "Rate"]}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="value"
                                    stroke="#2563EB"
                                    strokeWidth={2}
                                    dot={false}
                                    activeDot={{ r: 6 }}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </CardContent>
            </Card>

            {/* 2. Home Price Index Chart */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">National Home Price Index</CardTitle>
                    <CardDescription>S&P/Case-Shiller U.S. National Index</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="h-[200px] w-full min-w-0">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={data.homePriceIndex}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                                <XAxis
                                    dataKey="date"
                                    tickFormatter={formatDate}
                                    stroke="#9CA3AF"
                                    fontSize={12}
                                    minTickGap={30}
                                />
                                <YAxis
                                    domain={['auto', 'auto']}
                                    stroke="#9CA3AF"
                                    fontSize={12}
                                />
                                <Tooltip
                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    labelFormatter={(label) => new Date(label).toLocaleDateString()}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="value"
                                    stroke="#10B981"
                                    strokeWidth={2}
                                    dot={false}
                                    activeDot={{ r: 6 }}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
