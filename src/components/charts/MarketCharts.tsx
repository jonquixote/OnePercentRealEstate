'use client';

import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Info } from 'lucide-react';

interface MarketChartsProps {
    property: any;
    benchmark: any;
}

const formatCurrency = (val: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);

export default function MarketCharts({ property, benchmark }: MarketChartsProps) {
    const rent = property.estimated_rent || 0;
    const price = property.listing_price || 0;
    const bedrooms = property.financial_snapshot?.bedrooms || 3;

    const vacancy = rent * 0.05;
    const maintenance = rent * 0.05;
    const management = rent * 0.10;
    const taxes = (price * 0.02) / 12;
    const insurance = (price * 0.005) / 12;
    const totalExpenses = vacancy + maintenance + management + taxes + insurance;
    const cashFlow = rent - totalExpenses;

    const economicsData = [
        { name: 'Gross Rent', value: Math.round(rent), fill: '#4ade80' },
        { name: 'Expenses', value: -Math.round(totalExpenses), fill: '#f87171' },
        { name: 'Net Flow', value: Math.round(cashFlow), fill: '#60a5fa' },
    ];

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <Card>
                <CardHeader>
                    <CardTitle>Rent vs. HUD Fair Market Rent</CardTitle>
                </CardHeader>
                <CardContent>
                    {benchmark?.safmr_data ? (
                        <>
                            <div className="h-[300px] w-full min-h-[300px] min-w-0">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart
                                        data={[
                                            {
                                                name: 'Rent Comparison',
                                                'Estimated Rent': rent,
                                                'HUD FMR': benchmark?.safmr_data?.[`${bedrooms}br`] || 0
                                            }
                                        ]}
                                        margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                                    >
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="name" />
                                        <YAxis />
                                        <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                                        <Legend />
                                        <Bar dataKey="Estimated Rent" fill="#8884d8" name="Est. Rent" />
                                        <Bar dataKey="HUD FMR" fill="#82ca9d" name={`HUD FMR (${bedrooms}BR)`} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                            <p className="text-xs text-gray-500 mt-4">
                                Comparison of this property's estimated rent against the HUD Small Area Fair Market Rent (SAFMR) for {property.raw_data?.zip_code}.
                            </p>
                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-[200px] text-gray-500">
                            <Info className="h-8 w-8 mb-2 opacity-40" />
                            <p className="text-sm font-medium">HUD Fair Market Rent data unavailable</p>
                            <p className="text-xs text-gray-400 mt-1">Using smart estimate based on nearby rental comps instead</p>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Monthly Deal Economics</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="h-[300px] w-full min-h-[300px] min-w-0">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                                data={economicsData}
                                margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                            >
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="name" />
                                <YAxis />
                                <Tooltip formatter={(value) => formatCurrency(Math.abs(Number(value)))} />
                                <Bar dataKey="value" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                    <p className="text-xs text-gray-500 mt-4">
                        Simplified breakdown: Gross Rent minus estimated expenses (Vacancy 5%, Maint 5%, Mgmt 10%, Taxes ~2%, Ins ~0.5%). Excludes mortgage.
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}
