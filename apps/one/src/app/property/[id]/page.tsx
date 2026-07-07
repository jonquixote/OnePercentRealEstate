'use client';

import { use, useState, useEffect } from 'react';
import { getProperty, getHudBenchmark, getDemographics } from '@/app/actions';
import { Loader2 } from 'lucide-react';
import { Schema, type RealEstateListingData } from '@oper/primitives';
import { calculatePropertyMetrics } from '@/lib/calculators';
import { PhotoGallery } from '@/components/property/PhotoGallery';
import { useToast } from '@/components/ui/toast';
import { parseSchools } from '@/lib/schools';

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en-US');

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
    const [hudData, setHudData] = useState<any>(null);
    const [compsMedian, setCompsMedian] = useState<number | null>(null);
    const [comps, setComps] = useState<any[]>([]);
    const [compsSummary, setCompsSummary] = useState<any>(null);
    const [demographics, setDemographics] = useState<any>(null);
    const [mortgageRate, setMortgageRate] = useState<number | null>(null);
    const [watched, setWatched] = useState(false);
    const [savingWatch, setSavingWatch] = useState(false);
    const [loading, setLoading] = useState(true);
    const { showToast, ToastView } = useToast();

    useEffect(() => {
        async function fetchProperty() {
            try {
                const data = await getProperty(id);
                if (data) {
                    setProperty(data);
                    const zip = data.raw_data?.zip_code;
                    if (zip) {
                        const [hud, rentRes, compsRes, demoRes, rateRes, watchRes] = await Promise.all([
                            getHudBenchmark(zip),
                            fetch(`/api/estimate-rent`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ zip_code: zip, listing_id: id }) }).then(r => r.json()).catch(() => null),
                            fetch(`/api/properties/${id}/comps`).then(r => r.ok ? r.json() : null).catch(() => null),
                            getDemographics(zip),
                            fetch('/api/mortgage-rates').then(r => r.json()).then(d => d.rate ?? null).catch(() => null),
                            fetch('/api/watchlists').then(r => r.ok ? r.json() : []).catch(() => []),
                        ]);
                        if (hud) setHudData(hud);
                        if (rentRes?.comps_median) setCompsMedian(rentRes.comps_median);
                        if (compsRes?.comps) setComps(compsRes.comps);
                        if (compsRes?.summary) setCompsSummary(compsRes.summary);
                        if (demoRes) setDemographics(demoRes);
                        if (rateRes) setMortgageRate(rateRes);
                        const watchName = `Property: ${data.address}`;
                        if (Array.isArray(watchRes) && watchRes.some((w: any) => w.name === watchName)) setWatched(true);
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
        return <div className="flex h-screen items-center justify-center bg-ink"><Loader2 className="h-8 w-8 animate-spin text-pass" /></div>;
    }

    if (!property) {
        return <div className="flex h-screen items-center justify-center bg-ink"><p className="text-muted-foreground">Property not found.</p></div>;
    }

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

    const { monthlyCashflow, capRate, cashOnCash } = calculatePropertyMetrics(price, rent, {}, {}, property.target_ratio != null ? { targetRatio: Number(property.target_ratio) } : undefined);

    // Find HUD FMR for the right bedroom count
    const hudRow = hudData && Array.isArray(hudData)
        ? hudData.find((h: any) => Number(h.bedrooms) === (beds ?? 3))
        : null;
    const hudFmr = hudRow ? Number(hudRow.safmr) : null;

    const schemaData = buildSchemaData(property, id);
    const listingUrl = raw.property_url || raw.url || null;

    // Build provenance for the masthead
    const provParts: string[] = [];
    if (cutPct && firstPrice) provParts.push(`−${(cutPct * 100).toFixed(1)}% since list`);
    if (dom) provParts.push(`${dom} days on market`);
    if (motivated) provParts.push(`seller motivation ${motivated}`);

    // Build spec string
    const specParts: string[] = [];
    if (beds) specParts.push(`${beds} bd`);
    if (baths) specParts.push(`${baths} ba`);
    if (sqft) specParts.push(`${num.format(sqft)} sqft`);
    if (raw.year_built) specParts.push(`built ${raw.year_built}`);
    if (raw.city) specParts.push(raw.city);
    if (property.style) specParts.push(property.style);

    return (
        <div style={{ background: 'var(--ink)', color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>
            {schemaData && <Schema kind="RealEstateListing" data={schemaData} />}

            <div className="mx-auto max-w-6xl px-6 py-10">

                {/* ── Masthead ──────────────────────────────────────────────── */}
                <header className="flex flex-wrap items-end justify-between gap-6 pb-8" style={{ borderBottom: '1px solid var(--line)' }}>
                    <div>
                        {provParts.length > 0 && (
                            <p className="prov prov--brass mb-3 inline-block">{provParts.join(' · ')}</p>
                        )}
                        <h1 style={{ font: '400 var(--display-2)/1.15 var(--font-display)' }}>
                            {property.address}
                        </h1>
                        <p className="mt-2 text-[13px]" style={{ color: 'var(--haze)' }}>
                            {specParts.join(' · ') || ''}
                            {listingUrl && (
                                <a className="ml-3" style={{ color: 'var(--info)' }} href={listingUrl} target="_blank" rel="noopener noreferrer">
                                    source listing ↗
                                </a>
                            )}
                        </p>
                    </div>
                    <div className="text-right">
                        <p className="figure text-[34px]">{price > 0 ? usd0.format(price) : '—'}</p>
                        {firstPrice != null && firstPrice > price && (
                            <p className="text-[12px] line-through" style={{ color: 'var(--mute)' }}>
                                {usd0.format(firstPrice)} first listed
                            </p>
                        )}
                    </div>
                </header>

                <div className="mt-10 grid grid-cols-1 gap-12 lg:grid-cols-[1fr_360px]">

                    {/* ── Left: the dossier ───────────────────────────────── */}
                    <main className="space-y-14">

                        {/* Photo gallery */}
                        <PhotoGallery images={property.images || []} address={property.address} />

                        {/* Rent, three ways */}
                        <section>
                            <h2 className="prov mb-5 inline-block">rent, three ways</h2>
                            <div className="space-y-4">
                                {/* Model estimate with band */}
                                <div>
                                    <div className="flex items-baseline justify-between">
                                        <span className="text-[14px]" style={{ color: 'var(--haze)' }}>OnePercent model (v{property.rent_model_version || '1'})</span>
                                        <span className={`figure text-[18px] ${hasRent ? 'figure--pass' : ''}`}>
                                            {hasRent ? `${usd0.format(rent)}/mo` : '—'}
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
                                </div>

                                {/* HUD SAFMR */}
                                <div>
                                    <div className="flex items-baseline justify-between">
                                        <span className="text-[14px]" style={{ color: 'var(--haze)' }}>
                                            HUD Fair Market Rent · {raw.zip_code || ''} · {beds ? `${beds}BR` : ''}
                                        </span>
                                        <span className="figure text-[18px]">
                                            {hudFmr ? `${usd0.format(hudFmr)}/mo` : '—'}
                                        </span>
                                    </div>
                                </div>

                                {/* Comps median */}
                                <div>
                                    <div className="flex items-baseline justify-between">
                                        <span className="text-[14px]" style={{ color: 'var(--haze)' }}>Area comps median (last 90d)</span>
                                        <span className="figure text-[18px]">
                                            {compsMedian != null ? `${usd0.format(compsMedian)}/mo` : '—'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <p className="mt-4 text-[12px]" style={{ color: 'var(--mute)' }}>
                                Band = the model&rsquo;s p10–p90. FMR from HUD SAFMR FY2026. Never a naked estimate.
                            </p>
                        </section>

                        {/* Seller intel */}
                        {(cutPct || motivated || dom) && (
                            <section>
                                <h2 className="prov prov--brass mb-5 inline-block">seller intel</h2>
                                <div className="grid grid-cols-1 gap-4 text-[14px] sm:grid-cols-3">
                                    {cutPct != null && (
                                        <div className="rounded-[var(--r-panel)] p-4" style={{ background: 'var(--ink-panel)', border: '1px solid var(--line)' }}>
                                            <p style={{ color: 'var(--haze)' }}>Price cut</p>
                                            <p className="figure text-[20px]" style={{ color: 'var(--brass-hi)' }}>−{(cutPct * 100).toFixed(1)}%</p>
                                            {firstPrice && <p className="text-[11px]" style={{ color: 'var(--mute)' }}>from {usd0.format(firstPrice)}</p>}
                                        </div>
                                    )}
                                    {dom != null && (
                                        <div className="rounded-[var(--r-panel)] p-4" style={{ background: 'var(--ink-panel)', border: '1px solid var(--line)' }}>
                                            <p style={{ color: 'var(--haze)' }}>Days on market</p>
                                            <p className="figure text-[20px]">{dom}</p>
                                        </div>
                                    )}
                                    {motivated != null && (
                                        <div className="rounded-[var(--r-panel)] p-4" style={{ background: 'var(--ink-panel)', border: '1px solid var(--line)' }}>
                                            <p style={{ color: 'var(--haze)' }}>Motivation score</p>
                                            <p className={`figure text-[20px] ${motivated >= 60 ? '' : ''}`} style={{ color: motivated >= 60 ? 'var(--brass-hi)' : 'var(--text)' }}>{motivated}/100</p>
                                        </div>
                                    )}
                                </div>
                            </section>
                        )}

                        {/* Sold comps / ARV — Track B */}
                        <section>
                            <h2 className="prov mb-5 inline-block">what actually sold nearby</h2>
                            {comps.length > 0 ? (
                                <div className="space-y-3">
                                    {compsSummary?.median_sold_price && (
                                        <div className="mb-4 rounded-[var(--r-panel)] p-4" style={{ background: 'var(--ink-panel)', border: '1px solid var(--line)' }}>
                                            <div className="flex items-baseline justify-between">
                                                <span style={{ color: 'var(--haze)' }}>Median sold price (90d)</span>
                                                <span className="figure">{usd0.format(compsSummary.median_sold_price)}</span>
                                            </div>
                                            {compsSummary.avg_price_per_sqft && (
                                                <p className="mt-1 text-[12px]" style={{ color: 'var(--mute)' }}>
                                                    ${compsSummary.avg_price_per_sqft}/sqft avg · {comps.length} comps
                                                </p>
                                            )}
                                        </div>
                                    )}
                                    <div className="max-h-[400px] space-y-2 overflow-y-auto">
                                        {comps.slice(0, 10).map((c: any) => (
                                            <div key={c.id} className="flex items-baseline justify-between rounded-[var(--r-panel)] p-3 text-[14px]"
                                                 style={{ background: 'var(--ink-2)', border: '1px solid var(--line)' }}>
                                                <div>
                                                    <span className="figure">{usd0.format(c.sold_price)}</span>
                                                    {c.sqft && <span className="text-[12px]" style={{ color: 'var(--mute)' }}> · ${Math.round(c.sold_price / c.sqft)}/sqft</span>}
                                                </div>
                                                <div className="text-right">
                                                    <span className="text-[12px]" style={{ color: 'var(--haze)' }}>
                                                        {c.bedrooms ? `${c.bedrooms}bd` : ''}{c.bathrooms ? `/${c.bathrooms}ba` : ''}{c.sqft ? ` · ${num.format(c.sqft)}sqft` : ''}
                                                    </span>
                                                    <br />
                                                    <span className="text-[11px]" style={{ color: 'var(--mute)' }}>
                                                        {c.sold_date ? String(c.sold_date).slice(0, 10) : ''}{c.distance_meters ? ` · ${Math.round(c.distance_meters / 1609)}mi` : ''}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    {/* ARV = P75 sold $/sqft × subject sqft (Track B §B4). The old
                                        median×0.7 was the 70%-RULE MAO DISCOUNT mislabeled as ARV —
                                        it would double-discount inside maoFlip. */}
                                    {(compsSummary?.p75_price_per_sqft && sqft ? (
                                        <div className="flex items-center gap-3 pt-4" style={{ borderTop: '1px solid var(--line)' }}>
                                            <span className="text-[14px]" style={{ color: 'var(--haze)' }}>After-repair value</span>
                                            <span className="figure text-[18px]">{usd0.format(Math.round(compsSummary.p75_price_per_sqft * sqft))}</span>
                                            <span className="prov prov--real">ARV from sold comps · P75 ${Math.round(compsSummary.p75_price_per_sqft)}/sqft</span>
                                        </div>
                                    ) : property.estimated_value != null ? (
                                        <div className="flex items-center gap-3 pt-4" style={{ borderTop: '1px solid var(--line)' }}>
                                            <span className="text-[14px]" style={{ color: 'var(--haze)' }}>After-repair value</span>
                                            <span className="figure text-[18px]">{usd0.format(Number(property.estimated_value))}</span>
                                            <span className="prov prov--est">ARV from source estimate</span>
                                        </div>
                                    ) : null)}
                                </div>
                            ) : property.last_sold_price != null && property.last_sold_date ? (
                                <div className="rounded-[var(--r-panel)] p-4" style={{ background: 'var(--ink-panel)', border: '1px solid var(--line)' }}>
                                    <div className="flex items-baseline justify-between">
                                        <span style={{ color: 'var(--haze)' }}>Last recorded sale</span>
                                        <span className="figure">{usd0.format(Number(property.last_sold_price))}</span>
                                    </div>
                                    <p className="mt-1 text-[12px]" style={{ color: 'var(--mute)' }}>
                                        {String(property.last_sold_date).slice(0, 10)}
                                        {sqft ? ` · ${usd0.format(Number(property.last_sold_price) / sqft)}/sqft` : ''}
                                    </p>
                                </div>
                            ) : (
                                <p className="text-[14px]" style={{ color: 'var(--mute)' }}>
                                    Sold comps are being computed — check back soon.
                                </p>
                            )}
                        </section>

                        {/* Locale: schools · ACS · NRI */}
                        <section>
                            <h2 className="prov mb-5 inline-block">the locale</h2>
                            <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
                                <div>
                                    {schools.length > 0 ? (
                                        <>
                                            <p className="mb-3 text-[13px] font-medium">Schools</p>
                                            <ul className="space-y-2 text-[14px]" style={{ color: 'var(--haze)' }}>
                                                {schools.map((s, i) => (
                                                    <li key={i}>{s.name}{s.distance ? ` · ${s.distance}` : ''}{s.rating ? ` · rated ${s.rating}` : ''}</li>
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
                                        <span>{demographics?.nri_rating || '—'} <span className="prov ml-1">FEMA NRI</span></span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span style={{ color: 'var(--haze)' }}>Median household income</span>
                                        <span className="figure">{demographics?.median_hh_income ? usd0.format(demographics.median_hh_income) : '—'}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span style={{ color: 'var(--haze)' }}>Median area rent</span>
                                        <span className="figure">{demographics?.median_gross_rent ? `${usd0.format(demographics.median_gross_rent)}/mo` : '—'}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span style={{ color: 'var(--haze)' }}>Median home value</span>
                                        <span className="figure">{demographics?.median_home_value ? usd0.format(demographics.median_home_value) : '—'}</span>
                                    </div>
                                </div>
                            </div>
                        </section>
                    </main>

                    {/* ── Right: sticky financial rail ────────────────────── */}
                    <aside className="lg:sticky lg:top-8 h-fit rounded-[var(--r-panel)] p-6"
                           style={{ background: 'var(--ink-panel)', border: '1px solid var(--line)' }}>
                        <p className="prov mb-4 inline-block">the verdict</p>

                        <div className="flex items-baseline gap-3">
                            <span className={`figure text-[40px] ${ratioPct && ratioPct >= targetPct ? 'figure--pass' : ''}`}
                                  style={ratioPct != null && ratioPct < targetPct ? { color: 'var(--haze)' } : undefined}>
                                {ratioPct != null ? `${ratioPct.toFixed(2)}%` : '—'}
                            </span>
                            <span className="text-[13px]" style={{ color: 'var(--haze)' }}>
                                vs {targetPct.toFixed(1)}% target
                            </span>
                        </div>
                        <div className="rule-line my-4" />

                        <dl className="space-y-3 text-[14px]">
                            {[
                                ['Modeled rent', hasRent ? `${usd0.format(rent)}/mo` : '—', 'model v1', hasRent],
                                ['Property tax', taxAnnual ? `${usd0.format(taxAnnual)}/yr` : '—', 'listing', !!taxAnnual],
                                ['Insurance', insurance ? `${usd0.format(insurance)}/yr` : '—', 'state avg', !!insurance],
                                ['HOA', hoa != null ? (hoa > 0 ? `${usd0.format(hoa)}/mo` : 'None') : '—', 'listing', hoa != null],
                            ].map(([k, v, src, ok]) => (
                                <div key={k as string} className="flex items-baseline justify-between gap-2">
                                    <dt style={{ color: 'var(--haze)' }}>{k}</dt>
                                    <dd className="flex items-center gap-2">
                                        <span className="figure">{v as string}</span>
                                        <span className={`prov ${ok ? 'prov--real' : 'prov--est'}`}>{src as string}</span>
                                    </dd>
                                </div>
                            ))}
                        </dl>

                        <div className="my-5" style={{ borderTop: '1px solid var(--line)' }} />

                        <dl className="space-y-3 text-[14px]">
                            <div className="flex justify-between">
                                <dt style={{ color: 'var(--haze)' }}>Cap rate</dt>
                                <dd className="figure">{capRate ? `${(capRate * 100).toFixed(1)}%` : '—'}</dd>
                            </div>
                            <div className="flex justify-between">
                                <dt style={{ color: 'var(--haze)' }}>Cash flow</dt>
                                <dd className={`figure ${monthlyCashflow >= 0 ? 'figure--pass' : 'figure--loss'}`}>
                                    {monthlyCashflow != null ? `${monthlyCashflow >= 0 ? '+' : ''}${usd0.format(Math.abs(Math.round(monthlyCashflow)))}/mo` : '—'}
                                </dd>
                            </div>
                            <div className="flex justify-between">
                                <dt style={{ color: 'var(--haze)' }}>Cash-on-cash</dt>
                                <dd className="figure">{cashOnCash ? `${(cashOnCash * 100).toFixed(1)}%` : '—'}</dd>
                            </div>
                        </dl>

                        <button
                            onClick={async () => {
                                if (savingWatch) return;
                                if (watched) {
                                    setSavingWatch(true);
                                    try {
                                        const watchRes = await fetch('/api/watchlists').then(r => r.ok ? r.json() : []);
                                        const existing = Array.isArray(watchRes) ? watchRes.find((w: any) => w.name === `Property: ${property.address}`) : null;
                                        if (existing?.id) await fetch(`/api/watchlists?id=${existing.id}`, { method: 'DELETE' });
                                        setWatched(false);
                                    } catch { showToast('Failed to remove watchlist.'); }
                                    setSavingWatch(false);
                                    return;
                                }
                                setSavingWatch(true);
                                try {
                                    const resp = await fetch('/api/watchlists', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            name: `Property: ${property.address}`,
                                            query_json: {
                                                zip_code: raw.zip_code,
                                                price: { max: price * 1.05 },
                                                bedrooms: beds ? { min: beds - 1, max: beds + 1 } : undefined,
                                            },
                                        }),
                                    });
                                    if (resp.ok) setWatched(true);
                                    else showToast('Failed to create watchlist. Are you logged in?');
                                } catch { showToast('Failed to create watchlist.'); }
                                setSavingWatch(false);
                            }}
                            disabled={savingWatch}
                            className="mt-6 w-full rounded-full py-2.5 text-[14px] font-semibold transition-colors disabled:opacity-50"
                            style={{ background: watched ? 'var(--line-hi)' : 'var(--pass)', color: watched ? 'var(--text)' : '#fff' }}>
                            {savingWatch ? 'Saving…' : watched ? 'Watching' : 'Watch this property'}
                        </button>
                        <p className="mt-3 text-center text-[11px]" style={{ color: 'var(--mute)' }}>
                            financing: 20% down · {mortgageRate != null ? `${mortgageRate.toFixed(2)}%` : '—'} (FRED, live) · 30yr
                        </p>
                    </aside>
                </div>


            </div>
            {ToastView}
        </div>
    );
}
