'use client';

import { useState, useEffect } from 'react';
import { Loader2, MapPin, TrendingUp, Building, Info, ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { updatePropertyRent } from '@/app/actions';

interface RentEstimate {
    estimated_rent: number;
    hud_fmr: number | null;
    comps_avg: number | null;
    smart_estimate: number | null;
    confidence_score: number;
    comps_used: number;
    method: string;
    comps: Array<{
        address: string;
        price: number;
        beds?: number;
        baths?: number;
        sqft?: number;
        distance: number;
        score?: number;
    }>;
}

interface AdvancedRentEstimatorProps {
    property: any;
    onEstimateUpdate: (newRent: number) => void;
}

export function AdvancedRentEstimator({ property, onEstimateUpdate }: AdvancedRentEstimatorProps) {
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<string>('');
    const [estimate, setEstimate] = useState<RentEstimate | null>(null);
    const [showDetails, setShowDetails] = useState(false);
    const [showComps, setShowComps] = useState(false);

    useEffect(() => {
        if (property) {
            handleAnalyze();
        }
    }, [property]);

    const handleAnalyze = async () => {
        setLoading(true);
        setEstimate(null);

        try {
            setStatus('Analyzing market data...');
            const estRes = await fetch('/api/estimate-rent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lat: property.latitude || property.raw_data?.latitude,
                    lon: property.longitude || property.raw_data?.longitude,
                    beds: property.financial_snapshot?.bedrooms || property.bedrooms,
                    baths: property.financial_snapshot?.bathrooms || property.bathrooms,
                    sqft: property.financial_snapshot?.sqft || property.sqft,
                    year_built: property.raw_data?.year_built,
                    zip_code: property.raw_data?.zip_code
                })
            });

            if (!estRes.ok) throw new Error('Estimation failed');
            const estData = await estRes.json();

            setEstimate(estData);
            if (estData?.estimated_rent) {
                onEstimateUpdate(estData.estimated_rent);
                // Persist the smart estimate to the database
                if (property?.id) {
                    await updatePropertyRent(property.id, estData.estimated_rent, estData.method);
                }
            } else {
                setStatus('No comparable rental listings found nearby.');
            }

        } catch (err: any) {
            console.error(err);
            setStatus(`Error: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    const formatCurrency = (val: number | null | undefined) => {
        if (!val) return '—';
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            maximumFractionDigits: 0
        }).format(val);
    };

    const getConfidenceColor = (score: number) => {
        if (score >= 0.7) return 'text-emerald-600 bg-emerald-50';
        if (score >= 0.5) return 'text-amber-600 bg-amber-50';
        return 'text-red-500 bg-red-50';
    };

    const getMethodLabel = (method: string) => {
        switch (method) {
            case 'smart_weighted': return 'ML-Weighted';
            case 'comps_average': return 'Comps Avg';
            case 'hud_fmr': return 'HUD FMR';
            case 'fallback_comps': return 'Basic Comps';
            default: return 'Estimated';
        }
    };

    return (
        <Card className="bg-white border-slate-200 shadow-lg overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-4">
                <div className="flex items-center gap-2 text-white font-semibold">
                    <TrendingUp className="h-5 w-5" />
                    OnePercent Smart Estimate
                </div>
            </div>

            <CardContent className="p-0">
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-10 text-gray-500">
                        <Loader2 className="h-10 w-10 animate-spin mb-3 text-blue-600" />
                        <p className="text-sm font-medium animate-pulse">{status}</p>
                    </div>
                ) : !estimate?.estimated_rent ? (
                    <div className="text-center py-8 px-4">
                        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-slate-100 mb-4">
                            <Building className="h-7 w-7 text-slate-400" />
                        </div>
                        <p className="text-sm font-medium text-gray-900 mb-1">
                            {status || "Unable to generate estimate"}
                        </p>
                        <p className="text-xs text-gray-500 max-w-[240px] mx-auto">
                            We need more rental data in this area. Run the rental scraper to collect comps.
                        </p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100">
                        {/* Main Estimate */}
                        <div className="p-6 text-center bg-gradient-to-b from-slate-50 to-white">
                            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                                Estimated Monthly Rent
                            </p>
                            <div className="text-5xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent tracking-tight">
                                {formatCurrency(estimate.estimated_rent)}
                            </div>

                            {/* Confidence & Method Badges */}
                            <div className="flex items-center justify-center gap-3 mt-4">
                                <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${getConfidenceColor(estimate.confidence_score)}`}>
                                    {Math.round(estimate.confidence_score * 100)}% Confidence
                                </span>
                                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                                    {getMethodLabel(estimate.method)}
                                </span>
                                {estimate.comps_used > 0 && (
                                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                                        {estimate.comps_used} Comps
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* 3-Tier Breakdown */}
                        <div className="p-4">
                            <button
                                onClick={() => setShowDetails(!showDetails)}
                                className="w-full flex items-center justify-between text-sm font-medium text-slate-700 hover:text-slate-900"
                            >
                                <span className="flex items-center gap-2">
                                    <Info className="h-4 w-4" />
                                    How We Calculate This
                                </span>
                                {showDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </button>

                            {showDetails && (
                                <div className="mt-4 space-y-3">
                                    {/* HUD FMR */}
                                    <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100">
                                        <div>
                                            <p className="text-sm font-medium text-slate-900">HUD Fair Market Rent</p>
                                            <p className="text-xs text-slate-500">Government benchmark</p>
                                        </div>
                                        <span className={`text-lg font-bold ${estimate.hud_fmr ? 'text-slate-900' : 'text-slate-300'}`}>
                                            {formatCurrency(estimate.hud_fmr)}
                                        </span>
                                    </div>

                                    {/* Comps Average */}
                                    <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100">
                                        <div>
                                            <p className="text-sm font-medium text-slate-900">Nearby Rentals Avg</p>
                                            <p className="text-xs text-slate-500">Similar properties</p>
                                        </div>
                                        <span className={`text-lg font-bold ${estimate.comps_avg ? 'text-slate-900' : 'text-slate-300'}`}>
                                            {formatCurrency(estimate.comps_avg)}
                                        </span>
                                    </div>

                                    {/* Smart Estimate */}
                                    <div className="flex items-center justify-between p-3 rounded-lg bg-blue-50 border border-blue-200">
                                        <div>
                                            <p className="text-sm font-medium text-blue-900">Smart Weighted Estimate</p>
                                            <p className="text-xs text-blue-600">ML-powered analysis</p>
                                        </div>
                                        <span className="text-lg font-bold text-blue-700">
                                            {formatCurrency(estimate.smart_estimate || estimate.estimated_rent)}
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Comparable Rentals */}
                        {estimate.comps && estimate.comps.length > 0 && (
                            <div className="p-4">
                                <button
                                    onClick={() => setShowComps(!showComps)}
                                    className="w-full flex items-center justify-between text-sm font-medium text-slate-700 hover:text-slate-900"
                                >
                                    <span className="flex items-center gap-2">
                                        <MapPin className="h-4 w-4" />
                                        Comparable Rentals ({estimate.comps.length})
                                    </span>
                                    {showComps ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                </button>

                                {showComps && (
                                    <div className="mt-4 space-y-2">
                                        {estimate.comps.slice(0, 5).map((comp, i) => (
                                            <div
                                                key={i}
                                                className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100 hover:border-blue-200 transition-colors"
                                            >
                                                <div className="flex-1 min-w-0 mr-4">
                                                    <p className="text-sm font-medium text-slate-900 truncate" title={comp.address}>
                                                        {comp.address?.split(',')[0] || 'Unknown'}
                                                    </p>
                                                    <div className="flex items-center gap-2 text-xs text-slate-500">
                                                        <span>{comp.distance} mi</span>
                                                        {comp.beds && <span>• {comp.beds} bd</span>}
                                                        {comp.sqft && <span>• {comp.sqft} sqft</span>}
                                                        {comp.score && (
                                                            <span className="text-blue-600">• {Math.round(comp.score * 100)}% match</span>
                                                        )}
                                                    </div>
                                                </div>
                                                <span className="text-base font-bold text-blue-700 whitespace-nowrap">
                                                    {formatCurrency(comp.price)}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
