'use client';

import { Bed, Bath, Square, Calendar, Home, DollarSign, TrendingUp, MapPin, School, Percent, ExternalLink } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

const formatCurrency = (val: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);

const formatNumber = (val: number) => new Intl.NumberFormat('en-US').format(val);

interface PropertyOverviewTabProps {
    property: any;
    estCashflow: number;
    capRate: number;
    cashOnCash: number;
}

export function PropertyOverviewTab({ property, estCashflow, capRate, cashOnCash }: PropertyOverviewTabProps) {
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
                        <div className="flex items-center gap-2 text-muted-foreground mb-2">
                            <DollarSign className="h-4 w-4" />
                            <span className="text-sm font-medium">Listing Price</span>
                        </div>
                        <p className="text-3xl font-bold text-white">{listing_price > 0 ? formatCurrency(listing_price) : 'Price unavailable'}</p>
                        <p className="text-sm text-muted-foreground mt-1">
                            {raw_data?.sqft > 0
                                ? `$${Math.round(listing_price / raw_data.sqft).toLocaleString()}/sqft`
                                : 'N/A'}
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-6">
                        <div className="flex items-center gap-2 text-muted-foreground mb-2">
                            <TrendingUp className="h-4 w-4" />
                            <span className="text-sm font-medium">Rent Potential</span>
                        </div>
                        <p className={`text-3xl font-bold ${estimated_rent > 0 ? 'text-blue-600' : 'text-muted-foreground'}`}>
                            {estimated_rent > 0 ? formatCurrency(estimated_rent) : 'Pending...'}
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">
                            {estimated_rent > 0
                                ? `Based on market analysis`
                                : 'Awaiting smart estimate generation'
                            }
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-6">
                        <div className="flex items-center gap-2 text-muted-foreground mb-2">
                            <DollarSign className="h-4 w-4" />
                            <span className="text-sm font-medium">Est. Cashflow</span>
                        </div>
                        {estimated_rent > 0 ? (
                            <>
                                <p className={`text-3xl font-bold ${estCashflow >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {estCashflow > 0 ? '+' : ''}{formatCurrency(estCashflow)}<span className="text-lg text-muted-foreground font-normal">/mo</span>
                                </p>
                                <p className="text-sm text-muted-foreground mt-1">
                                    Based on 20% down
                                </p>
                            </>
                        ) : (
                            <>
                                <p className="text-3xl font-bold text-muted-foreground">
                                    --
                                </p>
                                <p className="text-sm text-muted-foreground mt-1">
                                    Requires rent estimate
                                </p>
                            </>
                        )}
                    </CardContent>
                </Card>
            </div>

            {estimated_rent > 0 && listing_price > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Card>
                        <CardContent className="p-6">
                            <div className="flex items-center gap-2 text-muted-foreground mb-2">
                                <Percent className="h-4 w-4" />
                                <span className="text-sm font-medium">Cap Rate</span>
                            </div>
                            <p className={`text-3xl font-bold ${capRate >= 6 ? 'text-green-600' : capRate >= 4 ? 'text-yellow-600' : 'text-red-600'}`}>
                                {capRate.toFixed(2)}%
                            </p>
                            <p className="text-sm text-muted-foreground mt-1">
                                Itemized-expense estimate · the Scorecard grade uses the 50% rule
                            </p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="p-6">
                            <div className="flex items-center gap-2 text-muted-foreground mb-2">
                                <TrendingUp className="h-4 w-4" />
                                <span className="text-sm font-medium">Cash-on-Cash</span>
                            </div>
                            <p className={`text-3xl font-bold ${cashOnCash >= 8 ? 'text-green-600' : cashOnCash >= 4 ? 'text-yellow-600' : 'text-red-600'}`}>
                                {cashOnCash.toFixed(2)}%
                            </p>
                            <p className="text-sm text-muted-foreground mt-1">
                                Annual cashflow / cash invested
                            </p>
                        </CardContent>
                    </Card>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-8">
                    <div className="bg-ink-panel rounded-xl border border-line p-6">
                        <h3 className="text-lg font-semibold text-white mb-4">Key Facts</h3>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
                            <div className="flex items-center gap-3">
                                <Bed className="h-5 w-5 text-muted-foreground" />
                                <div>
                                    <p className="text-sm text-muted-foreground">Bedrooms</p>
                                    <p className="font-medium text-white">{raw_data?.beds || 'N/A'}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <Bath className="h-5 w-5 text-muted-foreground" />
                                <div>
                                    <p className="text-sm text-muted-foreground">Bathrooms</p>
                                    <p className="font-medium text-white">{raw_data?.baths || 'N/A'}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <Square className="h-5 w-5 text-muted-foreground" />
                                <div>
                                    <p className="text-sm text-muted-foreground">Square Feet</p>
                                    <p className="font-medium text-white">{raw_data?.sqft ? formatNumber(raw_data.sqft) : 'N/A'}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <Calendar className="h-5 w-5 text-muted-foreground" />
                                <div>
                                    <p className="text-sm text-muted-foreground">Year Built</p>
                                    <p className="font-medium text-white">{financial_snapshot?.year_built || 'N/A'}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <Home className="h-5 w-5 text-muted-foreground" />
                                <div>
                                    <p className="text-sm text-muted-foreground">HOA</p>
                                    <p className="font-medium text-white">{raw_data?.hoa_fee ? formatCurrency(raw_data.hoa_fee) : 'None'}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <DollarSign className="h-5 w-5 text-muted-foreground" />
                                <div>
                                    <p className="text-sm text-muted-foreground">Tax/Year</p>
                                    <p className="font-medium text-white">{raw_data?.tax_annual_amount ? formatCurrency(raw_data.tax_annual_amount) : 'N/A'}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <Home className="h-5 w-5 text-muted-foreground" />
                                <div>
                                    <p className="text-sm text-muted-foreground">Lot Size</p>
                                    <p className="font-medium text-white">{raw_data?.lot_sqft ? formatNumber(raw_data.lot_sqft) + ' sqft' : 'N/A'}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <Home className="h-5 w-5 text-muted-foreground" />
                                <div>
                                    <p className="text-sm text-muted-foreground">Type</p>
                                    <p className="font-medium text-white capitalize">{raw_data?.style ? raw_data.style.replace(/_/g, ' ') : 'Single Family'}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-ink-panel rounded-xl border border-line p-6">
                        <h3 className="text-lg font-semibold text-white mb-4">Amenities & Features</h3>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div className="flex justify-between border-b border-line py-2">
                                <span className="text-muted-foreground">Cooling</span>
                                <span className="font-medium text-white">{raw_data?.cooling || 'None'}</span>
                            </div>
                            <div className="flex justify-between border-b border-line py-2">
                                <span className="text-muted-foreground">Heating</span>
                                <span className="font-medium text-white">{raw_data?.heating || 'None'}</span>
                            </div>
                            <div className="flex justify-between border-b border-line py-2">
                                <span className="text-muted-foreground">Parking</span>
                                <span className="font-medium text-white">{raw_data?.parking_garage || 'None'}</span>
                            </div>
                            <div className="flex justify-between border-b border-line py-2">
                                <span className="text-muted-foreground">Stories</span>
                                <span className="font-medium text-white">{raw_data?.stories || 'N/A'}</span>
                            </div>
                        </div>
                    </div>

                    <div className="bg-ink-panel rounded-xl border border-line p-6">
                        <h3 className="text-lg font-semibold text-white mb-4">About this Home</h3>
                        <p className="text-haze leading-relaxed whitespace-pre-line">
                            {raw_data?.text || raw_data?.description || "No description available for this property."}
                        </p>
                    </div>

                    <div className="bg-ink-panel rounded-xl border border-line p-6">
                        <h3 className="text-lg font-semibold text-white mb-4">Additional Details</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-xs font-mono text-haze">
                            {raw_data && Object.entries(raw_data).map(([key, value]) => {
                                if (['schools', 'alt_photos', 'primary_photo', 'description', 'text', 'neighborhood_stats', 'style', 'cooling', 'heating', 'parking_garage', 'stories', 'beds', 'baths', 'sqft', 'lot_sqft', 'year_built', 'hoa_fee', 'tax_annual_amount', 'mls_id', 'agent', 'broker'].includes(key) || value === null) return null;
                                return (
                                    <div key={key} className="flex justify-between border-b border-line py-1">
                                        <span className="font-medium text-muted-foreground capitalize">{key.replace(/_/g, ' ')}</span>
                                        <span className="text-white truncate max-w-[200px]" title={String(value)}>{String(value)}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <div className="space-y-6">
                    {(raw_data?.agent || raw_data?.broker) && (
                        <div className="bg-ink-panel rounded-xl border border-line p-6">
                            <h3 className="text-lg font-semibold text-white mb-4">Listing Agent</h3>
                            <div className="flex items-center gap-3 mb-2">
                                <div className="h-10 w-10 rounded-full bg-white/[0.05] flex items-center justify-center text-muted-foreground">
                                    <span className="font-bold text-lg">{raw_data?.agent ? raw_data.agent[0] : 'A'}</span>
                                </div>
                                <div>
                                    <p className="font-medium text-white">{raw_data?.agent || 'Unknown Agent'}</p>
                                    <p className="text-xs text-muted-foreground">{raw_data?.broker || 'Unknown Broker'}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="bg-ink-panel rounded-xl border border-line p-6">
                        <h3 className="text-lg font-semibold text-white mb-4">Location</h3>
                        <div className="aspect-video bg-white/[0.05] rounded-lg flex items-center justify-center mb-4">
                            <MapPin className="h-8 w-8 text-muted-foreground" />
                        </div>
                        <p className="text-sm text-haze">{address}</p>
                    </div>

                    <div className="bg-ink-panel rounded-xl border border-line p-6">
                        <h3 className="text-lg font-semibold text-white mb-4">Schools</h3>

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
                                        <div key={i} className="flex items-center gap-2 text-sm text-haze">
                                            <div className="h-2 w-2 rounded-full bg-blue-500" />
                                            {school}
                                        </div>
                                    ));
                                } else if (raw_data?.neighborhood_stats?.osm?.counts?.school) {
                                    return (
                                        <div className="text-sm text-haze">
                                            <div className="flex items-center gap-2 mb-2">
                                                <School className="w-4 h-4 text-blue-500" />
                                                <span className="font-medium">{raw_data.neighborhood_stats.osm.counts.school} Nearby Schools</span>
                                            </div>
                                            <p className="text-xs text-muted-foreground">
                                                (Detected via OpenStreetMap)
                                            </p>
                                        </div>
                                    );
                                } else {
                                    return <p className="text-sm text-muted-foreground">No school data available.</p>;
                                }
                            })()}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
