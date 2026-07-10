import { Suspense } from 'react';
import { getProperty, getHudBenchmark, getDemographics } from '@/app/actions';
import { Schema, type RealEstateListingData } from '@oper/primitives';
import { calculatePropertyMetrics } from '@/lib/calculators';
import { PhotoGallery } from '@/components/property/PhotoGallery';
import { PriceSparkline } from '@/components/property/PriceSparkline';
import { parseSchools } from '@/lib/schools';
import MenuHeader from '@/components/property/sections/MenuHeader';
import StickyTabNav from '@/components/property/sections/StickyTabNav';
import { SectionSkeleton } from '@/components/property/PropertySkeleton';
import { RentCompsLine } from '@/components/property/sections/RentCompsLine';
import { SoldCompsList } from '@/components/property/sections/SoldCompsList';
import { AnalysisSection } from '@/components/property/sections/AnalysisSection';
import { FinancialCalculatorSection } from '@/components/property/sections/FinancialCalculatorSection';
import { NearbyStrategiesSection } from '@/components/property/sections/NearbyStrategiesSection';
import { RentalCompsSection } from '@/components/property/sections/RentalCompsSection';
import VerdictRailClient from '@/components/property/sections/VerdictRailClient';

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en-US');

function buildSchemaData(property: Record<string, any>, id: string): RealEstateListingData | null {
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

function NotFound() {
    return (
        <div className="flex h-screen items-center justify-center" style={{ background: 'var(--ink)' }}>
            <p className="text-muted-foreground">Property not found.</p>
        </div>
    );
}

export default async function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const property = await getProperty(id);
    if (!property) return <NotFound />;

    const zip = property.raw_data?.zip_code;
    const [hudData, demographics] = await Promise.all([
        zip ? getHudBenchmark(zip).catch(() => null) : null,
        zip ? getDemographics(zip).catch(() => null) : null,
    ]);

    const raw = property.raw_data || {};
    const price = Number(property.listing_price) || 0;
    const rent = Number(property.estimated_rent) || 0;
    const rentLow = property.rent_low != null ? Number(property.rent_low) : null;
    const rentHigh = property.rent_high != null ? Number(property.rent_high) : null;
    const beds = property.financial_snapshot?.bedrooms ?? property.bedrooms ?? null;
    const baths = property.financial_snapshot?.bathrooms ?? property.bathrooms ?? null;
    const sqft = property.financial_snapshot?.sqft ?? property.sqft ?? null;
    const hasRent = rent > 0;
    const ratioPct = hasRent && price > 0 ? (rent / price) * 100 : null;
    const targetPct = property.target_ratio != null ? Number(property.target_ratio) * 100 : 1.0;
    const cutPct = property.price_cut_pct != null && Number(property.price_cut_pct) > 0 ? Number(property.price_cut_pct) : null;
    const dom = property.days_on_market != null ? Number(property.days_on_market) : null;
    const motivated = property.motivated_score != null ? Number(property.motivated_score) : null;
    const firstPrice = property.first_list_price != null ? Number(property.first_list_price) : null;
    const hoa = property.hoa_fee != null ? Number(property.hoa_fee) : null;
    const taxAnnual = property.tax_annual_amount != null ? Number(property.tax_annual_amount) : null;
    const insurance = property.insurance_state_avg != null ? Number(property.insurance_state_avg) : null;
    const schools = parseSchools(raw.schools);
    const neighborhoods = property.neighborhoods ?? null;
    const county = property.county ?? null;
    const listingUrl = raw.property_url || raw.url || null;

    const { monthlyCashflow, capRate, cashOnCash } = calculatePropertyMetrics(
        price, rent, {}, {},
        property.target_ratio != null ? { targetRatio: Number(property.target_ratio) } : undefined
    );

    const hudRow = hudData && Array.isArray(hudData)
        ? hudData.find((h: { bedrooms: string; safmr: string }) => Number(h.bedrooms) === (beds ?? 3))
        : null;
    const hudFmr = hudRow ? Number(hudRow.safmr) : null;

    const provParts: string[] = [];
    if (cutPct != null && firstPrice != null) provParts.push(`\u2212${(cutPct * 100).toFixed(1)}% since list`);
    if (dom != null) provParts.push(`${dom} days on market`);
    if (motivated != null && motivated > 0) provParts.push(`seller motivation ${motivated}`);

    const specParts: string[] = [];
    if (beds) specParts.push(`${beds} bd`);
    if (baths) specParts.push(`${baths} ba`);
    if (sqft) specParts.push(`${num.format(sqft)} sqft`);
    if (raw.year_built) specParts.push(`built ${raw.year_built}`);
    if (raw.city) specParts.push(raw.city);
    if (property.style) specParts.push(property.style);

    return (
        <div style={{ background: 'var(--ink)', color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>
            <Schema kind="RealEstateListing" data={buildSchemaData(property, id) as any} />

            {/* Sticky menu header */}
            <MenuHeader id={id} address={property.address} price={price} propertyUrl={listingUrl} />

            {/* Sticky tab nav */}
            <StickyTabNav />

            <div className="mx-auto max-w-7xl px-6 py-8 lg:px-8">
                <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1fr_360px]">

                    {/* ── Left: dossier ─────────────────── */}
                    <main className="space-y-14">

                        {/* ── Overview ─────────────────────── */}
                        <section id="overview" className="scroll-mt-32">
                            <PhotoGallery images={property.images || []} address={property.address} />

                            <header className="mt-6 flex flex-wrap items-end justify-between gap-6 pb-8" style={{ borderBottom: '1px solid var(--line)' }}>
                                <div>
                                    {provParts.length > 0 && (
                                        <p className="prov prov--brass mb-3 inline-block">{provParts.join(' \u00b7 ')}</p>
                                    )}
                                    <h1 style={{ font: '400 var(--display-2)/1.15 var(--font-display)' }}>
                                        {property.address}
                                    </h1>
                                    <p className="mt-2 text-[13px]" style={{ color: 'var(--haze)' }}>
                                        {specParts.join(' · ') || ''}
                                        {listingUrl && (
                                            <>
                                                <span className="mx-2" style={{ color: 'var(--mute)' }}>·</span>
                                                <a style={{ color: 'var(--info)' }} href={listingUrl} target="_blank" rel="noopener noreferrer">
                                                    source listing ↗
                                                </a>
                                            </>
                                        )}
                                    </p>
                                </div>
                                <div className="text-right">
                                    <p className="figure text-[34px]">{price > 0 ? usd0.format(price) : '\u2014'}</p>
                                    {firstPrice != null && firstPrice > price && (
                                        <p className="text-[12px] line-through" style={{ color: 'var(--mute)' }}>
                                            {usd0.format(firstPrice)} first listed
                                        </p>
                                    )}
                                </div>
                            </header>

                            {/* Price sparkline */}
                            <div className="mt-4">
                                <PriceSparkline propertyId={id} />
                            </div>

                            {/* Seller intel */}
                            {(cutPct != null || (motivated != null && motivated > 0) || dom != null) && (
                                <section className="mt-8">
                                    <h2 className="prov prov--brass mb-5 inline-block">seller intel</h2>
                                    <div className="grid grid-cols-1 gap-4 text-[14px] sm:grid-cols-3">
                                        {cutPct != null && (
                                            <div className="rounded-[var(--r-panel)] p-4" style={{ background: 'var(--ink-panel)', border: '1px solid var(--line)' }}>
                                                <p style={{ color: 'var(--haze)' }}>Price cut</p>
                                                <p className="figure text-[20px]" style={{ color: 'var(--brass-hi)' }}>\u2212{(cutPct * 100).toFixed(1)}%</p>
                                                {firstPrice != null && <p className="text-[11px]" style={{ color: 'var(--mute)' }}>from {usd0.format(firstPrice)}</p>}
                                            </div>
                                        )}
                                        {dom != null && (
                                            <div className="rounded-[var(--r-panel)] p-4" style={{ background: 'var(--ink-panel)', border: '1px solid var(--line)' }}>
                                                <p style={{ color: 'var(--haze)' }}>Days on market</p>
                                                <p className="figure text-[20px]">{dom}</p>
                                            </div>
                                        )}
                                        {motivated != null && motivated > 0 && (
                                            <div className="rounded-[var(--r-panel)] p-4" style={{ background: 'var(--ink-panel)', border: '1px solid var(--line)' }}>
                                                <p style={{ color: 'var(--haze)' }}>Motivation score</p>
                                                <p className={`figure text-[20px] ${motivated >= 60 ? '' : ''}`} style={{ color: motivated >= 60 ? 'var(--brass-hi)' : 'var(--text)' }}>{motivated}/100</p>
                                            </div>
                                        )}
                                    </div>
                                </section>
                            )}
                        </section>

                        {/* ── Financials ──────────────────── */}
                        <section id="financials" className="scroll-mt-32">
                            <h2 className="prov mb-5 inline-block">rent, three ways</h2>
                            <div className="space-y-5">
                                {/* Model estimate */}
                                <div className="rounded-[var(--r-panel)] p-4" style={{ background: 'var(--ink-panel)', border: '1px solid var(--line)' }}>
                                    <div className="flex items-baseline justify-between">
                                        <span className="text-[13px] font-medium" style={{ color: 'var(--haze)' }}>OnePercent model (v{property.rent_model_version || '1'})</span>
                                        <span className={`figure text-[20px] ${hasRent ? 'figure--pass' : ''}`}>
                                            {hasRent ? `${usd0.format(rent)}/mo` : '\u2014'}
                                        </span>
                                    </div>
                                    {hasRent && rentLow != null && rentHigh != null && (() => {
                                        const loPct = Math.max(0, (rentLow / rent) * 100);
                                        const hiPct = Math.min(100, (rentHigh / rent) * 100);
                                        const markPct = (loPct + hiPct) / 2;
                                        return (
                                            <div className="band mt-2">
                                                <div className="band-fill" style={{ left: `${loPct}%`, width: `${hiPct - loPct}%` }} />
                                                <div className="band-mark" style={{ left: `${markPct}%` }} />
                                            </div>
                                        );
                                    })()}
                                    {hasRent && rentLow != null && rentHigh != null && (
                                        <p className="mt-1 text-[11px]" style={{ color: 'var(--mute)' }}>
                                            p10–p90 confidence band
                                        </p>
                                    )}
                                </div>

                                {/* HUD FMR */}
                                <div className="rounded-[var(--r-panel)] p-4" style={{ background: 'var(--ink-panel)', border: '1px solid var(--line)' }}>
                                    <div className="flex items-baseline justify-between">
                                        <span className="text-[13px] font-medium" style={{ color: 'var(--haze)' }}>
                                            HUD Fair Market Rent · {raw.zip_code || ''} · {beds ? `${beds}BR` : ''}
                                        </span>
                                        <span className="figure text-[20px]">
                                            {hudFmr ? `${usd0.format(hudFmr)}/mo` : '\u2014'}
                                        </span>
                                    </div>
                                </div>

                                {/* Comps median (streamed) */}
                                <Suspense fallback={
                                    <div className="rounded-[var(--r-panel)] p-4" style={{ background: 'var(--ink-panel)', border: '1px solid var(--line)' }}>
                                        <div className="flex items-baseline justify-between">
                                            <span className="text-[13px] font-medium" style={{ color: 'var(--haze)' }}>Area comps median (last 90d)</span>
                                            <span className="figure text-[20px]">\u2014</span>
                                        </div>
                                    </div>
                                }>
                                    <RentCompsLine id={id} zip={zip} />
                                </Suspense>
                            </div>
                            <p className="mt-3 text-[11px]" style={{ color: 'var(--mute)' }}>
                                FMR from HUD SAFMR FY2026. Never a naked estimate.
                            </p>
                        </section>

                        {/* ── Comps ─────────────────────────── */}
                        <section id="comps" className="scroll-mt-32">
                            <h2 className="prov mb-5 inline-block">what actually sold nearby</h2>
                            <Suspense fallback={<SectionSkeleton lines={4} />}>
                                <SoldCompsList id={id} property={property} sqft={sqft} />
                            </Suspense>

                            <div className="mt-8">
                                <Suspense fallback={<SectionSkeleton lines={2} />}>
                                    <RentalCompsSection id={id} />
                                </Suspense>
                            </div>
                        </section>

                        {/* ── Location ────────────────────── */}
                        <section id="location" className="scroll-mt-32">
                            <h2 className="prov mb-5 inline-block">the locale</h2>
                            <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
                                <div>
                                    {schools.length > 0 ? (
                                        <>
                                            <p className="mb-3 text-[13px] font-medium">Schools</p>
                                            <ul className="space-y-2 text-[14px]" style={{ color: 'var(--haze)' }}>
                                                {schools.map((s: { name?: string; distance?: string; rating?: string }, i: number) => (
                                                    <li key={i}>{s.name}{s.distance ? ` \u00b7 ${s.distance}` : ''}{s.rating ? ` \u00b7 rated ${s.rating}` : ''}</li>
                                                ))}
                                            </ul>
                                        </>
                                    ) : neighborhoods ? (
                                        <>
                                            <p className="mb-3 text-[13px] font-medium">Neighborhood context</p>
                                            <p className="text-[14px]" style={{ color: 'var(--haze)' }}>{neighborhoods}</p>
                                        </>
                                    ) : county ? (
                                        <>
                                            <p className="mb-3 text-[13px] font-medium">County</p>
                                            <p className="text-[14px]" style={{ color: 'var(--haze)' }}>{county}</p>
                                        </>
                                    ) : null}
                                </div>
                                <div className="space-y-4 text-[14px]">
                                    <div className="flex justify-between">
                                        <span style={{ color: 'var(--haze)' }}>Flood risk index</span>
                                        <span>{demographics?.nri_rating || '\u2014'} <span className="prov ml-1">FEMA NRI</span></span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span style={{ color: 'var(--haze)' }}>Median household income</span>
                                        <span className="figure">{demographics?.median_hh_income ? usd0.format(demographics.median_hh_income) : '\u2014'}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span style={{ color: 'var(--haze)' }}>Median area rent</span>
                                        <span className="figure">{demographics?.median_gross_rent ? `${usd0.format(demographics.median_gross_rent)}/mo` : '\u2014'}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span style={{ color: 'var(--haze)' }}>Median home value</span>
                                        <span className="figure">{demographics?.median_home_value ? usd0.format(demographics.median_home_value) : '\u2014'}</span>
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* ── Analysis (streamed) ────────── */}
                        <section id="analysis" className="scroll-mt-32">
                            <h2 className="prov mb-5 inline-block">deal analysis</h2>
                            <Suspense fallback={<SectionSkeleton lines={6} />}>
                                <AnalysisSection property={property} hudData={hudData} demographics={demographics} />
                            </Suspense>
                        </section>

                        {/* ── Calculator ─────────────────── */}
                        <section id="calculator" className="scroll-mt-32">
                            <FinancialCalculatorSection property={property} />
                        </section>

                        {/* ── Nearby ─────────────────────── */}
                        <section id="nearby" className="scroll-mt-32">
                            <h2 className="prov mb-5 inline-block">nearby by strategy</h2>
                            <NearbyStrategiesSection id={id} zipCode={zip} lat={property.latitude} lng={property.longitude} beds={beds} />
                        </section>
                    </main>

                    {/* ── Right: verdict rail ─────────────── */}
                    <aside className="lg:sticky lg:top-32 h-fit" style={{ position: 'sticky' }}>
                        <VerdictRailClient
                            property={property}
                            hudData={hudData}
                            price={price}
                            rent={rent}
                            beds={beds}
                            sqft={sqft}
                            hasRent={hasRent}
                            ratioPct={ratioPct}
                            targetPct={targetPct}
                            taxAnnual={taxAnnual}
                            insurance={insurance}
                            hoa={hoa}
                            monthlyCashflow={monthlyCashflow}
                            capRate={capRate}
                            cashOnCash={cashOnCash}
                        />
                    </aside>
                </div>
            </div>
        </div>
    );
}
