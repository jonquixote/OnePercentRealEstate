'use client';

import dynamic from 'next/dynamic';
import { MapPin, Coffee, Utensils, School, TreePine, Dumbbell, ShoppingBag, Bus, Stethoscope, Store } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const MarketCharts = dynamic(() => import('@/components/charts/MarketCharts'), {
    ssr: false,
    loading: () => <div className="h-[300px] w-full bg-gray-50 animate-pulse rounded" />
});

const formatCurrency = (val: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);

interface PropertyMarketTabProps {
    property: any;
    benchmark: any;
}

export function PropertyMarketTab({ property, benchmark }: PropertyMarketTabProps) {
    const { raw_data = {} } = property || {};

    return (
        <div id="tabpanel-market" role="tabpanel" aria-labelledby="tab-market" className="space-y-8 animate-in fade-in duration-300">
            <MarketCharts property={property} benchmark={benchmark} />

            {raw_data?.neighborhood_stats && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-white rounded-xl border border-gray-200 p-6">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-lg font-semibold text-gray-900">Neighborhood Vibe</h3>
                            {raw_data.neighborhood_stats.osm && (
                                <Badge className={`${raw_data.neighborhood_stats.osm.total_count > 20 ? 'bg-green-100 text-green-800 hover:bg-green-200' :
                                    raw_data.neighborhood_stats.osm.total_count > 10 ? 'bg-blue-100 text-blue-800 hover:bg-blue-200' :
                                        'bg-gray-100 text-gray-800 hover:bg-gray-200'
                                    } px-3 py-1 text-sm font-medium border-none`}>
                                    {raw_data.neighborhood_stats.osm.total_count > 20 ? 'Vibrant' :
                                        raw_data.neighborhood_stats.osm.total_count > 10 ? 'Active' : 'Quiet'}
                                </Badge>
                            )}
                        </div>

                        {raw_data.neighborhood_stats.osm ? (
                            <div>
                                <div className="grid grid-cols-2 gap-4">
                                    {Object.entries(raw_data.neighborhood_stats.osm.counts || {})
                                        .sort(([, a], [, b]) => Number(b) - Number(a))
                                        .slice(0, 8)
                                        .map(([amenity, count]) => {
                                            const getIcon = (type: string) => {
                                                switch (type) {
                                                    case 'cafe': return <Coffee className="w-4 h-4 text-amber-600" />;
                                                    case 'restaurant':
                                                    case 'fast_food': return <Utensils className="w-4 h-4 text-orange-600" />;
                                                    case 'school': return <School className="w-4 h-4 text-blue-600" />;
                                                    case 'park': return <TreePine className="w-4 h-4 text-green-600" />;
                                                    case 'gym': return <Dumbbell className="w-4 h-4 text-purple-600" />;
                                                    case 'shop':
                                                    case 'supermarket': return <ShoppingBag className="w-4 h-4 text-pink-600" />;
                                                    case 'bus_station': return <Bus className="w-4 h-4 text-indigo-600" />;
                                                    case 'hospital':
                                                    case 'pharmacy': return <Stethoscope className="w-4 h-4 text-red-600" />;
                                                    default: return <Store className="w-4 h-4 text-gray-600" />;
                                                }
                                            };

                                            return (
                                                <div key={amenity} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
                                                    <div className="flex items-center gap-3">
                                                        <div className="p-2 bg-white rounded-md shadow-sm">
                                                            {getIcon(amenity)}
                                                        </div>
                                                        <span className="text-sm font-medium text-gray-700 capitalize">
                                                            {amenity.replace(/_/g, ' ')}
                                                        </span>
                                                    </div>
                                                    <span className="text-sm font-bold text-gray-900">{String(count)}</span>
                                                </div>
                                            );
                                        })}
                                </div>
                                <p className="text-xs text-gray-400 mt-4 text-right">
                                    {raw_data.neighborhood_stats.osm.total_count} amenities within 1km
                                </p>
                            </div>
                        ) : (
                            <div className="text-center py-8 text-gray-500">
                                <MapPin className="w-8 h-8 mx-auto mb-2 opacity-20" />
                                <p>No amenity data available.</p>
                            </div>
                        )}
                    </div>

                    <div className="bg-white rounded-xl border border-gray-200 p-6">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">Local Economy</h3>
                        {raw_data.neighborhood_stats.census ? (
                            <div className="space-y-4">
                                <div>
                                    <p className="text-sm text-gray-500">Area</p>
                                    <p className="font-medium text-gray-900">{raw_data.neighborhood_stats.census.area_name}</p>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-sm text-gray-500">Median Income</p>
                                        <p className="text-xl font-bold text-green-600">
                                            {formatCurrency(Number(raw_data.neighborhood_stats.census.median_income))}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-gray-500">Total Population</p>
                                        <p className="text-xl font-bold text-gray-900">
                                            {Number(raw_data.neighborhood_stats.census.population).toLocaleString()}
                                        </p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-sm text-gray-500">In Poverty</p>
                                        <p className="text-lg font-medium text-red-600">
                                            {Number(raw_data.neighborhood_stats.census.poverty_count).toLocaleString()}
                                            <span className="text-sm text-gray-500 ml-1">
                                                ({raw_data.neighborhood_stats.census.poverty_rate}%)
                                            </span>
                                        </p>
                                    </div>
                                    {raw_data.neighborhood_stats.census.unemployment && (
                                        <div>
                                            <p className="text-sm text-gray-500">Unemployment</p>
                                            <p className="text-lg font-medium text-gray-900">
                                                {raw_data.neighborhood_stats.census.unemployment.rate}%
                                            </p>
                                            <p className="text-[10px] text-gray-400">
                                                {raw_data.neighborhood_stats.census.unemployment.period}
                                            </p>
                                        </div>
                                    )}
                                </div>
                                <p className="text-xs text-gray-400 mt-2 text-right">
                                    Source: US Census SAIPE ({raw_data.neighborhood_stats.census.year}) & BLS
                                </p>
                            </div>
                        ) : (
                            <p className="text-gray-500 text-sm">No economic data available.</p>
                        )}
                    </div>
                </div>
            )}

            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
                <h3 className="text-lg font-semibold text-gray-900">Market Trends</h3>
                <p className="text-gray-500 mt-2">Historical data and neighborhood analytics coming soon.</p>
            </div>
        </div>
    );
}
