'use client';

import { use, useState, useEffect } from 'react';
import { getProperty, getHudBenchmark } from '@/app/actions';
import { Loader2 } from 'lucide-react';
import { PropertyReport } from '@/components/PropertyReport';
import { calculatePropertyMetrics } from '@/lib/calculators';
import { PropertyHero } from '@/components/PropertyHero';
import { PropertyTabs } from '@/components/PropertyTabs';
import { PropertyHeader } from '@/components/property/PropertyHeader';
import { PropertyOverviewTab } from '@/components/property/PropertyOverviewTab';
import { PropertyFinancialsTab } from '@/components/property/PropertyFinancialsTab';
import { PropertyMarketTab } from '@/components/property/PropertyMarketTab';
import { useToast } from '@/components/ui/toast';
import { usePropertyExport } from '@/hooks/usePropertyExport';

export default function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const [property, setProperty] = useState<any>(null);
    const [benchmark, setBenchmark] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('overview');
    const { reportRef, exporting, exportPdf } = usePropertyExport();
    const { showToast, ToastView } = useToast();

    useEffect(() => {
        async function fetchProperty() {
            try {
                const data = await getProperty(id);
                if (data) {
                    setProperty(data);
                    if (data.raw_data && data.raw_data.zip_code) {
                        const hudData = await getHudBenchmark(data.raw_data.zip_code);
                        if (hudData) setBenchmark({ safmr_data: hudData });
                    }
                }
            } catch (error) {
                console.error("Failed to fetch property", error);
            }
            setLoading(false);
        }
        fetchProperty();
    }, [id]);

    if (loading) {
        return <div className="flex h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-blue-600" /></div>;
    }

    if (!property) {
        return <div className="flex h-screen items-center justify-center"><p className="text-gray-500">Property not found.</p></div>;
    }

    const { address = '', listing_price = 0, estimated_rent = 0, status = 'watch', images = [] } = property;
    const { isOnePercentRule, monthlyCashflow } = calculatePropertyMetrics(listing_price, estimated_rent);

    return (
        <div className="min-h-screen bg-gray-50 pb-12">
            <div style={{ position: 'absolute', top: '-9999px', left: '-9999px' }}>
                <PropertyReport ref={reportRef} property={property} />
            </div>
            <PropertyHeader
                address={address}
                status={status}
                onExportPdf={() => exportPdf(address, showToast)}
                exporting={exporting}
            />
            <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 space-y-8">
                <PropertyHero images={images} address={address} />
                <PropertyTabs activeTab={activeTab} onTabChange={setActiveTab} />
                <div className="min-h-[500px]">
                    {activeTab === 'overview' && <PropertyOverviewTab property={property} estCashflow={monthlyCashflow} />}
                    {activeTab === 'financials' && <PropertyFinancialsTab property={property} isOnePercentRule={isOnePercentRule} />}
                    {activeTab === 'market' && <PropertyMarketTab property={property} benchmark={benchmark} />}
                </div>
            </main>
            {ToastView}
        </div>
    );
}
