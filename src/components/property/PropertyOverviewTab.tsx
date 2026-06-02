'use client';

import { Bed, Bath, Square, Calendar, Home, DollarSign, TrendingUp, MapPin, School } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

const formatCurrency = (val: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);

const formatNumber = (val: number) => new Intl.NumberFormat('en-US').format(val);

interface PropertyOverviewTabProps {
    property: any;
    estCashflow: number;
}

export function PropertyOverviewTab({ property, estCashflow }: PropertyOverviewTabProps) {
    const {
        address = '',
        listing_price = 0,
        estimated_rent = 0,
        financial_snapshot = {},
        images: _images = [],
        raw_data = {},
    } = property || {};

    return (
        <div id="tabpanel-overview" role="tabpanel" aria-labelledby="tab-overview" className="space-y-8 animate-in fade-in duration-300">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card>
                    <CardContent className="p-6">
                        <div className="flex items-center gap-2 text-gray-500 mb-2">
                            <DollarSign className="h-4 w-4" />
                            <span className="text-sm font-medium">Listing Price</span>
                        </div>
                        <p className="text-3xl font-bold text-gray-900">{listing_price > 0 ? formatCurrency(listing_price) : 'Price unavailable'}</p>
                        <p className="text-sm text-gray-500 mt-1">
                            {raw_data?.sqft > 0
                                ? `$${Math.round(listing_price / raw_data.sqft).toLocaleString()}/sqft`
                                : 'N/A'}
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-6">
                        <div className="flex items-center gap-2 text-gray-500 mb-2">
                            <TrendingUp className="h-4 w-4" />
                            <span className="text-sm font-medium">Rent Potential</span>
                        </div>
                        <p className={`text-3xl font-bold ${estimated_rent > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
                            {estimated_rent > 0 ? formatCurrency(estimated_rent) : 'Pending...'}
                        </p>
                        <p className="text-sm text-gray-500 mt-1">
                            {estimated_rent > 0
                                ? `Based on market analysis`
                                : 'Awaiting smart estimate generation'
                            }
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-6">
                        <div className="flex items-center gap-2 text-gray-500 mb-2">
                            <DollarSign className="h-4 w-4" />
                            <span className="text-sm font-medium">Est. Cashflow</span>
                        </div>
                        {estimated_rent > 0 ? (
                            <>
                                <p className={`text-3xl font-bold ${estCashflow >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {estCashflow > 0 ? '+' : ''}{formatCurrency(estCashflow)}<span className="text-lg text-gray-400 font-normal">/mo</span>
                                </p>
                                <p className="text-sm text-gray-500 mt-1">
                                    Based on 20% down
                                </p>
                            </>
                        ) : (
                            <>
                                <p className="text-3xl font-bold text-gray-300">
                                    --
                                </p>
                                <p className="text-sm text-gray-500 mt-1">
                                    Requires rent estimate
                                </p>
                            </>
                        )}
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-8">
                    <div className="bg-white rounded-xl border border-gray-200 p-6">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">Key Facts</h3>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
                            <div className="flex items-center gap-3">
                                <Bed className="h-5 w-5 text-gray-400" />
                                <div>
                                    <p className="text-sm text-gray-500">Bedrooms</p>
                                    <p className="font-medium text-gray-900">{raw_data?.beds || 'N/A'}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <Bath className="h-5 w-5 text-gray-400" />
                                <div>
                                    <p className="text-sm text-gray-500">Bathrooms</p>
                                    <p className="font-medium text-gray-900">{raw_data?.baths || 'N/A'}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <Square className="h-5 w-5 text-gray-400" />
                                <div>
                                    <p className="text-sm text-gray-500">Square Feet</p>
                                    <p className="font-medium text-gray-900">{raw_data?.sqft ? formatNumber(raw_data.sqft) : 'N/A'}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <Calendar className="h-5 w-5 text-gray-400" />
                                <div>
                                    <p className="text-sm text-gray-500">Year Built</p>
                                    <p className="font-medium text-gray-900">{financial_snapshot?.year_built || 'N/A'}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <Home className="h-5 w-5 text-gray-400" />
                                <div>
                                    <p className="text-sm text-gray-500">HOA</p>
                                    <p className="font-medium text-gray-900">{raw_data?.hoa_fee ? formatCurrency(raw_data.hoa_fee) : 'None'}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <DollarSign className="h-5 w-5 text-gray-400" />
                                <div>
                                    <p className="text-sm text-gray-500">Tax/Year</p>
                                    <p className="font-medium text-gray-900">{raw_data?.tax_annual_amount ? formatCurrency(raw_data.tax_annual_amount) : 'N/A'}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <Home className="h-5 w-5 text-gray-400" />
                                <div>
                                    <p className="text-sm text-gray-500">Lot Size</p>
                                    <p className="font-medium text-gray-900">{raw_data?.lot_sqft ? formatNumber(raw_data.lot_sqft) + ' sqft' : 'N/A'}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <Home className="h-5 w-5 text-gray-400" />
                                <div>
                                    <p className="text-sm text-gray-500">Type</p>
                                    <p className="font-medium text-gray-900 capitalize">{raw_data?.style ? raw_data.style.replace(/_/g, ' ') : 'Single Family'}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-xl border border-gray-200 p-6">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">Amenities & Features</h3>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div className="flex justify-between border-b border-gray-100 py-2">
                                <span className="text-gray-500">Cooling</span>
                                <span className="font-medium text-gray-900">{raw_data?.cooling || 'None'}</span>
                            </div>
                            <div className="flex justify-between border-b border-gray-100 py-2">
                                <span className="text-gray-500">Heating</span>
                                <span className="font-medium text-gray-900">{raw_data?.heating || 'None'}</span>
                            </div>
                            <div className="flex justify-between border-b border-gray-100 py-2">
                                <span className="text-gray-500">Parking</span>
                                <span className="font-medium text-gray-900">{raw_data?.parking_garage || 'None'}</span>
                            </div>
                            <div className="flex justify-between border-b border-gray-100 py-2">
                                <span className="text-gray-500">Stories</span>
                                <span className="font-medium text-gray-900">{raw_data?.stories || 'N/A'}</span>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-xl border border-gray-200 p-6">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">About this Home</h3>
                        <p className="text-gray-600 leading-relaxed whitespace-pre-line">
                            {raw_data?.text || raw_data?.description || "No description available for this property."}
                        </p>
                    </div>

                    <div className="bg-white rounded-xl border border-gray-200 p-6">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">Additional Details</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-xs font-mono text-gray-600">
                            {raw_data && Object.entries(raw_data).map(([key, value]) => {
                                if (['schools', 'alt_photos', 'primary_photo', 'description', 'text', 'neighborhood_stats', 'style', 'cooling', 'heating', 'parking_garage', 'stories', 'beds', 'baths', 'sqft', 'lot_sqft', 'year_built', 'hoa_fee', 'tax_annual_amount', 'mls_id', 'agent', 'broker'].includes(key) || value === null) return null;
                                return (
                                    <div key={key} className="flex justify-between border-b border-gray-100 py-1">
                                        <span className="font-medium text-gray-500 capitalize">{key.replace(/_/g, ' ')}</span>
                                        <span className="text-gray-900 truncate max-w-[200px]" title={String(value)}>{String(value)}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <div className="space-y-6">
                    {(raw_data?.agent || raw_data?.broker) && (
                        <div className="bg-white rounded-xl border border-gray-200 p-6">
                            <h3 className="text-lg font-semibold text-gray-900 mb-4">Listing Agent</h3>
                            <div className="flex items-center gap-3 mb-2">
                                <div className="h-10 w-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-500">
                                    <span className="font-bold text-lg">{raw_data?.agent ? raw_data.agent[0] : 'A'}</span>
                                </div>
                                <div>
                                    <p className="font-medium text-gray-900">{raw_data?.agent || 'Unknown Agent'}</p>
                                    <p className="text-xs text-gray-500">{raw_data?.broker || 'Unknown Broker'}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="bg-white rounded-xl border border-gray-200 p-6">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">Location</h3>
                        <div className="aspect-video bg-gray-100 rounded-lg flex items-center justify-center mb-4">
                            <MapPin className="h-8 w-8 text-gray-400" />
                        </div>
                        <p className="text-sm text-gray-600">{address}</p>
                    </div>

                    <div className="bg-white rounded-xl border border-gray-200 p-6">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">Schools</h3>

                        {raw_data?.neighborhood_stats?.census?.school_district && (
                            <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-100">
                                <h4 className="font-medium text-blue-900 mb-2">
                                    {raw_data.neighborhood_stats.census.school_district.name}
                                </h4>
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div>
                                        <p className="text-blue-700 opacity-80">District Pop.</p>
                                        <p className="font-semibold text-blue-900">
                                            {Number(raw_data.neighborhood_stats.census.school_district.population).toLocaleString()}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-blue-700 opacity-80">Child Poverty</p>
                                        <p className="font-semibold text-blue-900">
                                            {raw_data.neighborhood_stats.census.school_district.poverty_rate_5_17}%
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="space-y-3">
                            {(() => {
                                let schools: string[] = [];
                                if (Array.isArray(raw_data?.nearby_schools)) {
                                    schools = raw_data.nearby_schools;
                                } else if (typeof raw_data?.nearby_schools === 'string') {
                                    schools = raw_data.nearby_schools.split(',').map((s: string) => s.trim());
                                }

                                if (schools.length > 0) {
                                    return schools.map((school, i) => (
                                        <div key={i} className="flex items-center gap-2 text-sm text-gray-600">
                                            <div className="h-2 w-2 rounded-full bg-blue-500" />
                                            {school}
                                        </div>
                                    ));
                                } else if (raw_data?.neighborhood_stats?.osm?.counts?.school) {
                                    return (
                                        <div className="text-sm text-gray-600">
                                            <div className="flex items-center gap-2 mb-2">
                                                <School className="w-4 h-4 text-blue-500" />
                                                <span className="font-medium">{raw_data.neighborhood_stats.osm.counts.school} Nearby Schools</span>
                                            </div>
                                            <p className="text-xs text-gray-400">
                                                (Detected via OpenStreetMap)
                                            </p>
                                        </div>
                                    );
                                } else {
                                    return <p className="text-sm text-gray-500">No school data available.</p>;
                                }
                            })()}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
