'use client';

import { use, useState, useEffect } from 'react';
import { getProperty, getHudBenchmark } from '@/app/actions';
import { Loader2 } from 'lucide-react';
import { Schema, type RealEstateListingData } from '@oper/primitives';
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

function buildSchemaData(property: any, id: string): RealEstateListingData | null {
    if (!property) return null;
    const raw = property.raw_data || {};
    const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://one.octavo.press';
    const image: string[] = Array.isArray(property.images) ? property.images.filter(Boolean) : [];
    return {
        url: `${site}/property/${id}`,
        name: property.address || `Property ${id}`,
        description: typeof raw.text === 'string' ? raw.text.slice(0, 500) : undefined,
        image: image.length > 0 ? image : undefined,
        address: {
            streetAddress: property.address,
            addressLocality: raw.city || undefined,
            addressRegion: raw.state || undefined,
            postalCode: raw.zip_code || undefined,
            addressCountry: 'US',
        },
        geo: property.latitude && property.longitude
            ? { latitude: Number(property.latitude), longitude: Number(property.longitude) }
            : undefined,
        offers: property.listing_price
            ? { price: Number(property.listing_price), priceCurrency: 'USD', availability: 'InStock' }
            : undefined,
        numberOfBedrooms: property.financial_snapshot?.bedrooms || undefined,
        numberOfBathrooms: property.financial_snapshot?.bathrooms || undefined,
        floorSize: property.financial_snapshot?.sqft
            ? { value: property.financial_snapshot.sqft, unitCode: 'FTK' }
            : undefined,
        yearBuilt: raw.year_built || undefined,
        datePosted: property.created_at,
    };
}

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

    const { address = '', listing_price = 0, estimated_rent = 0, status = 'watch', images = [], raw_data: rawData = {} } = property;
    const listingUrl = rawData?.property_url || rawData?.url || null;
    const { isOnePercentRule, monthlyCashflow, capRate, cashOnCash } = calculatePropertyMetrics(listing_price, estimated_rent);
    const schemaData = buildSchemaData(property, id);

    return (
        <div className="min-h-screen bg-gray-50 pb-12">
            {schemaData && <Schema kind="RealEstateListing" data={schemaData} />}
            <div style={{ position: 'absolute', top: '-9999px', left: '-9999px' }}>
                <PropertyReport ref={reportRef} property={property} />
            </div>
            <PropertyHeader
                address={address}
                status={status}
                listingUrl={listingUrl}
                onExportPdf={() => exportPdf(address, showToast)}
                exporting={exporting}
            />
            <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 space-y-8">
                <PropertyHero images={images} address={address} />
                <PropertyTabs activeTab={activeTab} onTabChange={setActiveTab} />
                <div className="min-h-[500px]">
                    {activeTab === 'overview' && <PropertyOverviewTab property={property} estCashflow={monthlyCashflow} capRate={capRate} cashOnCash={cashOnCash} />}
                    {activeTab === 'financials' && <PropertyFinancialsTab property={property} isOnePercentRule={isOnePercentRule} />}
                    {activeTab === 'market' && <PropertyMarketTab property={property} benchmark={benchmark} />}
                </div>
            </main>
            {ToastView}
        </div>
    );
}
