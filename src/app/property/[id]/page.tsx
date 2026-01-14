'use client';

import { useEffect, useState, useRef, use } from 'react';
import { supabase } from '@/lib/supabase';
import { Loader2, ArrowLeft, Download, MapPin, Bed, Bath, Square, Calendar, Home, DollarSign, TrendingUp, Coffee, Utensils, School, TreePine, Dumbbell, ShoppingBag, Bus, Stethoscope, Store } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { PropertyReport } from '@/components/PropertyReport';
import { AdvancedRentEstimator } from '@/components/AdvancedRentEstimator';
import { CashflowCalculator } from '@/components/CashflowCalculator';
import { PropertyHero } from '@/components/PropertyHero';
import { PropertyTabs } from '@/components/PropertyTabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell
} from 'recharts';

export default function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const [property, setProperty] = useState<any>(null);
    const [benchmark, setBenchmark] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [exporting, setExporting] = useState(false);
    const [activeTab, setActiveTab] = useState('overview');
    const reportRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        async function fetchProperty() {
            const { data: propData, error: propError } = await supabase
                .from('properties')
                .select('*')
                .eq('id', id)
                .single();

            if (propError) {
                console.error('Error fetching property:', propError);
            } else {
                setProperty(propData);

                // Fetch Benchmark if Zip Code exists
                if (propData && propData.raw_data && propData.raw_data.zip_code) {
                    const zip = propData.raw_data.zip_code.toString();
                    const { data: benchData, error: benchError } = await supabase
                        .from('market_benchmarks')
                        .select('*')
                        .eq('zip_code', zip)
                        .single();

                    if (!benchError && benchData) {
                        setBenchmark(benchData);
                    }
                }
            }
            setLoading(false);
        }

        fetchProperty();
    }, [id]);

    const handleExportPdf = async () => {
        if (!reportRef.current) return;
        setExporting(true);

        try {
            const element = reportRef.current;
            element.style.display = 'block';

            const canvas = await html2canvas(element, {
                scale: 2,
                useCORS: true,
                logging: false
            });

            element.style.display = 'none';

            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF({
                orientation: 'portrait',
                unit: 'px',
                format: [canvas.width, canvas.height]
            });

            pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
            pdf.save(`property-report-${property.address.replace(/\s+/g, '-').toLowerCase()}.pdf`);
        } catch (err) {
            console.error("PDF Export failed:", err);
            alert("Failed to generate PDF. Please try again.");
        } finally {
            setExporting(false);
        }
    };

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
        );
    }

    if (!property) {
        return (
            <div className="flex h-screen items-center justify-center">
                <p className="text-gray-500">Property not found.</p>
            </div>
        );
    }

    const { address, listing_price, estimated_rent, financial_snapshot, status, images, raw_data } = property;

    // Formatters
    const formatCurrency = (val: number) =>
        new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);

    const formatNumber = (val: number) => new Intl.NumberFormat('en-US').format(val);

    // Basic Calcs
    const ratio = (estimated_rent / listing_price);
    const isGoodDeal = ratio >= 0.01;
    const estCashflow = (estimated_rent * 0.70) - ((listing_price * 0.8 * 0.065 / 12) + (listing_price * 0.012 / 12) + 100); // Rough calc for overview

    return (
        <div className="min-h-screen bg-gray-50 pb-12">
            {/* Hidden Report Component */}
            <div style={{ position: 'absolute', top: '-9999px', left: '-9999px' }}>
                <PropertyReport ref={reportRef} property={property} />
            </div>

            {/* Navigation Bar */}
            <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
                <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                    <div className="flex h-16 items-center justify-between">
                        <div className="flex items-center gap-4">
                            <Link href="/" className="p-2 -ml-2 text-gray-500 hover:text-gray-700 rounded-full hover:bg-gray-100">
                                <ArrowLeft className="h-5 w-5" />
                            </Link>
                            <h1 className="text-lg font-semibold text-gray-900 truncate max-w-md">{address}</h1>
                            <Badge variant={status === 'watch' ? 'default' : 'secondary'} className="capitalize">
                                {status.replace('_', ' ')}
                            </Badge>
                        </div>
                        <button
                            onClick={handleExportPdf}
                            disabled={exporting}
                            className="flex items-center rounded-md bg-white border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                            {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                            Export PDF
                        </button>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 space-y-8">
                {/* Hero Section */}
                <PropertyHero images={images} address={address} />

                {/* Tabs */}
                <PropertyTabs activeTab={activeTab} onTabChange={setActiveTab} />

                {/* Tab Content */}
                <div className="min-h-[500px]">
                    {activeTab === 'overview' && (
                        <div className="space-y-8 animate-in fade-in duration-300">
                            {/* Prominent Financial Cards */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <Card>
                                    <CardContent className="p-6">
                                        <div className="flex items-center gap-2 text-gray-500 mb-2">
                                            <DollarSign className="h-4 w-4" />
                                            <span className="text-sm font-medium">Listing Price</span>
                                        </div>
                                        <p className="text-3xl font-bold text-gray-900">{formatCurrency(listing_price)}</p>
                                        <p className="text-sm text-gray-500 mt-1">
                                            ${Math.round(listing_price / (raw_data?.sqft || 1)).toLocaleString()}/sqft
                                        </p>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardContent className="p-6">
                                        <div className="flex items-center gap-2 text-gray-500 mb-2">
                                            <TrendingUp className="h-4 w-4" />
                                            <span className="text-sm font-medium">Rent Potential</span>
                                        </div>
                                        <p className="text-3xl font-bold text-blue-600">{formatCurrency(estimated_rent)}</p>
                                        <p className="text-sm text-gray-500 mt-1">
                                            HUD Baseline: {formatCurrency(estimated_rent * 0.9)}
                                        </p>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardContent className="p-6">
                                        <div className="flex items-center gap-2 text-gray-500 mb-2">
                                            <DollarSign className="h-4 w-4" />
                                            <span className="text-sm font-medium">Est. Cashflow</span>
                                        </div>
                                        <p className={`text-3xl font-bold ${estCashflow >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            {estCashflow > 0 ? '+' : ''}{formatCurrency(estCashflow)}<span className="text-lg text-gray-400 font-normal">/mo</span>
                                        </p>
                                        <p className="text-sm text-gray-500 mt-1">
                                            Based on 20% down
                                        </p>
                                    </CardContent>
                                </Card>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                                {/* Left Column: Facts, Amenities, Description */}
                                <div className="lg:col-span-2 space-y-8">
                                    {/* Key Facts Grid */}
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

                                    {/* Amenities */}
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

                                    {/* Description */}
                                    <div className="bg-white rounded-xl border border-gray-200 p-6">
                                        <h3 className="text-lg font-semibold text-gray-900 mb-4">About this Home</h3>
                                        <p className="text-gray-600 leading-relaxed whitespace-pre-line">
                                            {raw_data?.text || raw_data?.description || "No description available for this property."}
                                        </p>
                                    </div>

                                    {/* Full Raw Data (Clean) */}
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

                                {/* Right Column: Location, Agent, Schools */}
                                <div className="space-y-6">
                                    {/* Listing Agent */}
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

                                        {/* School District Stats */}
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
                    )}

                    {activeTab === 'financials' && (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in duration-300">
                            <div className="lg:col-span-1 space-y-6">
                                <AdvancedRentEstimator
                                    property={property}
                                    onEstimateUpdate={() => { }}
                                />
                                <div className="bg-blue-50 border border-blue-100 rounded-xl p-6">
                                    <h3 className="text-blue-900 font-semibold mb-2">Analyst Note</h3>
                                    <p className="text-sm text-blue-800">
                                        This property {isGoodDeal ? 'passes' : 'does not pass'} the 1% rule.
                                        {isGoodDeal
                                            ? ' It shows strong potential for immediate cash flow.'
                                            : ' Consider negotiating the price down or verifying if market rents are higher.'}
                                    </p>
                                </div>
                            </div>
                            <div className="lg:col-span-2">
                                <CashflowCalculator property={property} />
                            </div>
                        </div>
                    )}

                    {activeTab === 'market' && (
                        <div className="space-y-8 animate-in fade-in duration-300">

                            {/* Charts Section */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                {/* Rent vs HUD FMR Chart */}
                                <Card>
                                    <CardHeader>
                                        <CardTitle>Rent vs. HUD Fair Market Rent</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="h-[300px]">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart
                                                    data={[
                                                        {
                                                            name: 'Rent Comparison',
                                                            'Estimated Rent': property.estimated_rent,
                                                            'HUD FMR': benchmark?.safmr_data?.[`${property.financial_snapshot?.bedrooms || 3}br`] || 0
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
                                                    <Bar dataKey="HUD FMR" fill="#82ca9d" name={`HUD FMR (${property.financial_snapshot?.bedrooms || 3}BR)`} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>
                                        <p className="text-xs text-gray-500 mt-4">
                                            Comparison of this property's estimated rent against the HUD Small Area Fair Market Rent (SAFMR) for {property.raw_data?.zip_code}.
                                        </p>
                                    </CardContent>
                                </Card>

                                {/* Deal Economics Waterfall */}
                                <Card>
                                    <CardHeader>
                                        <CardTitle>Monthly Deal Economics</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="h-[300px]">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart
                                                    data={(() => {
                                                        const rent = property.estimated_rent || 0;
                                                        const price = property.listing_price || 0;
                                                        const vacancy = rent * 0.05;
                                                        const maintenance = rent * 0.05;
                                                        const management = rent * 0.10;
                                                        const taxes = (price * 0.02) / 12;
                                                        const insurance = (price * 0.005) / 12;
                                                        const cashFlow = rent - (vacancy + maintenance + management + taxes + insurance);

                                                        return [
                                                            { name: 'Gross Rent', value: Math.round(rent), fill: '#4ade80' },
                                                            { name: 'Expenses', value: -Math.round(vacancy + maintenance + management + taxes + insurance), fill: '#f87171' },
                                                            { name: 'Net Flow', value: Math.round(cashFlow), fill: '#60a5fa' },
                                                        ];
                                                    })()}
                                                    margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                                                >
                                                    <CartesianGrid strokeDasharray="3 3" />
                                                    <XAxis dataKey="name" />
                                                    <YAxis />
                                                    <Tooltip formatter={(value) => formatCurrency(Math.abs(Number(value)))} />
                                                    <Bar dataKey="value">
                                                        {
                                                            // Cells are handled by data fill property
                                                        }
                                                    </Bar>
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>
                                        <p className="text-xs text-gray-500 mt-4">
                                            Simplified breakdown: Gross Rent minus estimated expenses (Vacancy 5%, Maint 5%, Mgmt 10%, Taxes ~2%, Ins ~0.5%). Excludes mortgage.
                                        </p>
                                    </CardContent>
                                </Card>
                            </div>

                            {/* Neighborhood Analytics */}
                            {raw_data?.neighborhood_stats && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {/* Amenities / Vibe */}
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
                                                        .sort(([, a], [, b]) => Number(b) - Number(a)) // Sort by count descending
                                                        .slice(0, 8) // Show top 8
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

                                    {/* Economic Data */}
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
                    )}
                </div>
            </main>
        </div>
    );
}
