import { useState, useEffect } from 'react';
import { Loader2, MapPin, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface AdvancedRentEstimatorProps {
    property: any;
    onEstimateUpdate: (newRent: number) => void;
}

export function AdvancedRentEstimator({ property, onEstimateUpdate }: AdvancedRentEstimatorProps) {
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<string>('');
    const [estimate, setEstimate] = useState<any>(null);

    useEffect(() => {
        if (property) {
            handleAnalyze();
        }
    }, [property]);

    const handleAnalyze = async () => {
        setLoading(true);
        setEstimate(null);

        try {
            // Run Estimation using pre-fetched DB data
            setStatus(`Analyzing market data...`);
            const estRes = await fetch('/api/estimate-rent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lat: property.raw_data?.latitude,
                    lon: property.raw_data?.longitude,
                    beds: property.financial_snapshot?.bedrooms,
                    baths: property.financial_snapshot?.bathrooms,
                    sqft: property.financial_snapshot?.sqft,
                    year_built: property.financial_snapshot?.year_built,
                    zip_code: property.raw_data?.zip_code
                })
            });

            if (!estRes.ok) throw new Error('Estimation failed');
            const estData = await estRes.json();

            setEstimate(estData);
            if (estData && estData.estimated_rent) {
                onEstimateUpdate(estData.estimated_rent);
            } else if (estData === null) {
                setStatus('No comparable rental listings found nearby.');
                setEstimate(null);
            }

        } catch (err: any) {
            console.error(err);
            setStatus(`Error: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Card className="bg-white border-blue-200 shadow-md overflow-hidden">
            <div className="bg-blue-50/50 p-4 border-b border-blue-100">
                <div className="flex items-center gap-2 text-blue-900 font-semibold">
                    <TrendingUp className="h-5 w-5 text-blue-600" />
                    Real-Time Market Estimate
                </div>
            </div>
            <CardContent className="p-6">
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-6 text-gray-500">
                        <Loader2 className="h-8 w-8 animate-spin mb-3 text-blue-600" />
                        <p className="text-sm font-medium animate-pulse">{status}</p>
                    </div>
                ) : !estimate ? (
                    <div className="text-center py-4">
                        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-50 mb-3">
                            <TrendingUp className="h-6 w-6 text-red-400" />
                        </div>
                        <p className="text-sm font-medium text-gray-900 mb-1">
                            {status || "Unable to generate estimate"}
                        </p>
                        <p className="text-xs text-gray-500 max-w-[200px] mx-auto">
                            Insufficient rental data nearby to provide a confident estimate.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-6">
                        <div className="text-center">
                            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Estimated Monthly Rent</p>
                            <div className="text-4xl font-bold text-blue-600 tracking-tight">
                                {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(estimate.estimated_rent)}
                            </div>
                            <div className="flex items-center justify-center gap-2 mt-2">
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                    {estimate.comps_used} Comps Used
                                </span>
                                <span className="text-xs text-gray-400">
                                    {Math.round(estimate.confidence_score * 100)}% Confidence
                                </span>
                            </div>
                            {estimate.safmr_rent && (
                                <div className="mt-2 text-xs text-gray-500">
                                    HUD SAFMR Benchmark: <span className="font-medium text-gray-700">{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(estimate.safmr_rent)}</span>
                                </div>
                            )}
                        </div>

                        {estimate.comps && estimate.comps.length > 0 && (
                            <div>
                                <p className="text-xs font-semibold text-gray-900 mb-3 flex items-center gap-2">
                                    <MapPin className="h-3 w-3" />
                                    Comparable Rentals Nearby
                                </p>
                                <div className="space-y-3">
                                    {estimate.comps.slice(0, 3).map((comp: any, i: number) => (
                                        <div key={i} className="flex items-center justify-between text-sm p-2 rounded-lg bg-gray-50 border border-gray-100 hover:border-blue-100 transition-colors">
                                            <div className="flex flex-col">
                                                <span className="font-medium text-gray-900 truncate max-w-[140px]" title={comp.address}>
                                                    {comp.address.split(',')[0]}
                                                </span>
                                                <span className="text-xs text-gray-500">
                                                    {comp.distance} mi away
                                                </span>
                                            </div>
                                            <span className="font-semibold text-blue-700">
                                                {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(comp.price)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );

}
