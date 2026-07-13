'use client';

import { use } from 'react';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useProperties, type PropertyListItem } from '@oper/api-client';
import { capRate, monthlyMortgage } from '@oper/primitives';
import { useSessionUser } from '@/lib/useSessionUser';
import { Photo } from '@/components/Photo';
import { COMPARE_FREE_MAX } from '@/components/compare/useCompare';

type Property = PropertyListItem;

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function formatPercent(val: number): string {
    return `${(val * 100).toFixed(2)}%`;
}

// Buy-hold default financing, mirrors the search filters' SQL exactly
// (50%-rule NOI, 80% LTV @ 6.5%/30yr, 23% invested).
function cashOnCash(price: number, rent: number): number | null {
    if (!(price > 0) || !(rent > 0)) return null;
    const noi = rent * 12 * 0.5;
    const debtService = monthlyMortgage(price * 0.8, 0.065, 30) * 12;
    return (noi - debtService) / (price * 0.23);
}

export default function ComparePage({ searchParams }: { searchParams: Promise<{ ids: string }> }) {
    const params = use(searchParams);
    const ids = params.ids ? params.ids.split(',').filter(Boolean) : [];
    const sessionUser = useSessionUser();
    const { data, isLoading, isError } = useProperties(ids, { compare: true });
    const properties: Property[] = data ?? [];

    if (isLoading) {
        return (
            <div className="flex h-screen items-center justify-center" style={{ background: 'var(--ink)' }}>
                <Loader2 className="h-8 w-8 animate-spin" style={{ color: 'var(--pass)' }} />
            </div>
        );
    }

    // Growth 1.3: server enforces the Compare(>2) gate. A free account hitting
    // the limit (e.g. a hand-crafted URL) gets a 402 — show the upgrade CTA.
    if (isError && sessionUser?.tier !== 'pro' && ids.length > COMPARE_FREE_MAX) {
        return (
            <div className="flex h-screen flex-col items-center justify-center gap-4" style={{ background: 'var(--ink)', color: 'var(--text)' }}>
                <h1 style={{ font: '400 var(--display-2)/1.1 var(--font-display)' }}>Compare is a Pro feature</h1>
                <p style={{ color: 'var(--haze)' }}>Free accounts can compare up to {COMPARE_FREE_MAX} properties at a time.</p>
                <Link href="/pricing" className="rounded-md bg-pass px-4 py-2 font-semibold text-white hover:bg-pass-hi">
                    Upgrade to compare more
                </Link>
                <Link href="/" style={{ color: 'var(--pass-hi)' }}>Return to Dashboard</Link>
            </div>
        );
    }

    if (properties.length === 0) {
        return (
            <div className="flex h-screen flex-col items-center justify-center gap-4" style={{ background: 'var(--ink)', color: 'var(--text)' }}>
                <p style={{ color: 'var(--haze)' }}>No properties selected for comparison.</p>
                <Link href="/" style={{ color: 'var(--pass-hi)' }}>
                    Return to Dashboard
                </Link>
            </div>
        );
    }

    const p = properties[0]; // use first for feature-names

    return (
        <div style={{ background: 'var(--ink)', color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>
            <div className="mx-auto max-w-7xl px-6 py-10">
                <header className="mb-8 flex items-center justify-between">
                    <div>
                        <h1 style={{ font: '400 var(--display-2)/1.1 var(--font-display)' }}>Property Comparison</h1>
                        <p className="mt-1 text-[14px]" style={{ color: 'var(--haze)' }}>Side-by-side analysis of selected opportunities.</p>
                    </div>
                    <Link href="/" className="flex items-center text-[13px]" style={{ color: 'var(--pass-hi)' }}>
                        Back to Dashboard
                    </Link>
                </header>

                <div className="overflow-x-auto pb-8">
                    <table className="w-full min-w-[800px] rounded-[var(--r-panel)]" style={{ borderCollapse: 'collapse' as const }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--line)' }}>
                                <th className="p-4 text-left text-[13px] font-semibold w-48" style={{ color: 'var(--haze)', background: 'var(--ink-2)', position: 'sticky', left: 0, zIndex: 20, borderRight: '1px solid var(--line)' }}>Feature</th>
                                {properties.map(p => (
                                    <th key={p.id} className="p-4 text-left min-w-[250px]" style={{ borderLeft: '1px solid var(--line)', background: 'var(--ink-2)' }}>
                                        <div>
                                            {p.images && p.images.length > 0 ? (
                                                <div className="mat"><Photo src={p.images[0]} alt={p.address} className="h-32 w-full rounded-[var(--r-mat)] object-cover" style={{ border: '1px solid var(--line)' }} /></div>
                                            ) : (
                                                <div className="mat"><div className="flex h-32 w-full items-center justify-center rounded-[var(--r-mat)]" style={{ background: 'var(--ink-2)', border: '1px solid var(--line)', color: 'var(--mute)' }}>No Image</div></div>
                                            )}
                                            <Link href={`/property/${p.id}`} className="mt-2 block text-[15px] font-semibold leading-snug" style={{ color: 'var(--text)' }}>
                                                {p.address}
                                            </Link>
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {/* Financials Section */}
                            <tr>
                                <td className="p-2 px-4 text-[10px] font-bold uppercase tracking-wider" colSpan={properties.length + 1}
                                    style={{ color: 'var(--mute)', background: 'var(--ink-2)', position: 'sticky', left: 0, zIndex: 10, borderRight: '1px solid var(--line)' }}>Financials</td>
                            </tr>
                            <TableRow label="Listing Price" properties={properties} render={(p) => usd0.format(p.listing_price ?? 0)} />
                            <TableRow label="Est. Rent" properties={properties} render={(p) => usd0.format(p.estimated_rent ?? 0)} />
                            <TableRow label="1% Rule Ratio" properties={properties} render={(p) => {
                                const rent = p.estimated_rent ?? 0;
                                const price = p.listing_price ?? 0;
                                const ratio = price > 0 ? rent / price : 0;
                                return (
                                    <span className="font-bold" style={{ color: ratio >= 0.01 ? 'var(--pass-hi)' : 'var(--brass-hi)' }}>
                                        {price > 0 ? formatPercent(ratio) : '—'}
                                    </span>
                                );
                            }} />
                            <TableRow label="Gross Yield" properties={properties} render={(p) => {
                                const rent = p.estimated_rent ?? 0;
                                const price = p.listing_price ?? 0;
                                const y = price > 0 ? (rent * 12) / price : 0;
                                return <>{price > 0 ? formatPercent(y) : '—'}</>;
                            }} />
                            <BestRow label="$ / sqft" properties={properties} best="min"
                                value={(p) => (p.listing_price && p.financial_snapshot?.sqft ? p.listing_price / p.financial_snapshot.sqft : null)}
                                format={(v) => usd0.format(v)} />
                            <BestRow label="Cap Rate (50% rule)" properties={properties} best="max"
                                value={(p) => (p.listing_price && p.estimated_rent ? capRate(p.listing_price, p.estimated_rent, 0.5) : null)}
                                format={formatPercent} />
                            <BestRow label="Cash-on-Cash (20% down)" properties={properties} best="max"
                                value={(p) => (p.listing_price && p.estimated_rent ? cashOnCash(p.listing_price, p.estimated_rent) : null)}
                                format={(v) => `${(v * 100).toFixed(1)}%`} />

                            {/* Specs Section */}
                            <tr>
                                <td className="p-2 px-4 text-[10px] font-bold uppercase tracking-wider" colSpan={properties.length + 1}
                                    style={{ color: 'var(--mute)', background: 'var(--ink-2)', position: 'sticky', left: 0, zIndex: 10, borderRight: '1px solid var(--line)' }}>Property Specs</td>
                            </tr>
                            <TableRow label="Bedrooms" properties={properties} render={(p) => String(p.financial_snapshot?.bedrooms ?? '-')} />
                            <TableRow label="Bathrooms" properties={properties} render={(p) => String(p.financial_snapshot?.bathrooms ?? '-')} />
                            <TableRow label="Sqft" properties={properties} render={(p) => p.financial_snapshot?.sqft?.toLocaleString() ?? '-'} />
                            <TableRow label="Year Built" properties={properties} render={(p) => String(p.financial_snapshot?.year_built ?? '-')} />

                            {/* Additional Data */}
                            <tr>
                                <td className="p-2 px-4 text-[10px] font-bold uppercase tracking-wider" colSpan={properties.length + 1}
                                    style={{ color: 'var(--mute)', background: 'var(--ink-2)', position: 'sticky', left: 0, zIndex: 10, borderRight: '1px solid var(--line)' }}>Additional Data</td>
                            </tr>
                            <TableRow label="HOA Fee" properties={properties} render={(p) => p.hoa_fee != null ? usd0.format(p.hoa_fee) : 'N/A'} />
                            <TableRow label="Status" properties={properties} render={(p) => (p.status || 'active').replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())} />
                            <TableRow label="Days on Market" properties={properties} render={(p) => p.days_on_market != null ? String(p.days_on_market) : '-'} />
                            <TableRow label="Price Cut" properties={properties} render={(p) => p.price_cut_pct != null && Number(p.price_cut_pct) > 0 ? `${(Number(p.price_cut_pct) * 100).toFixed(1)}%` : '—'} />
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

function TableRow({ label, properties, render }: {
    label: string;
    properties: Property[];
    render: (p: Property) => React.ReactNode;
}) {
    return (
        <tr style={{ borderBottom: '1px solid var(--line)' }}>
            <td className="p-4 text-[14px] font-medium" style={{ color: 'var(--haze)', background: 'var(--ink)', position: 'sticky', left: 0, zIndex: 10, borderRight: '1px solid var(--line)' }}>{label}</td>
            {properties.map(p => (
                <td key={p.id} className="p-4 text-[14px]" style={{ borderLeft: '1px solid var(--line)' }}>
                    {render(p)}
                </td>
            ))}
        </tr>
    );
}

// Numeric row with best-value highlighting: the winning cell gets the accent
// figure treatment + a small 'best' provenance tag.
function BestRow({ label, properties, value, format, best }: {
    label: string;
    properties: Property[];
    value: (p: Property) => number | null;
    format: (v: number) => string;
    best: 'max' | 'min';
}) {
    const values = properties.map(value);
    let bestIdx = -1;
    let bestVal: number | null = null;
    values.forEach((v, i) => {
        if (v == null) return;
        if (bestVal == null || (best === 'max' ? v > bestVal : v < bestVal)) {
            bestVal = v;
            bestIdx = i;
        }
    });
    return (
        <tr style={{ borderBottom: '1px solid var(--line)' }}>
            <td className="p-4 text-[14px] font-medium" style={{ color: 'var(--haze)', background: 'var(--ink)', position: 'sticky', left: 0, zIndex: 10, borderRight: '1px solid var(--line)' }}>{label}</td>
            {properties.map((p, i) => (
                <td key={p.id} className="p-4 text-[14px]" style={{ borderLeft: '1px solid var(--line)' }}>
                    {values[i] == null ? '—' : (
                        <span className="figure" style={i === bestIdx ? { color: 'var(--pass-hi)', fontWeight: 600 } : undefined}>
                            {format(values[i]!)}
                            {i === bestIdx && <span className="prov ml-1.5">best</span>}
                        </span>
                    )}
                </td>
            ))}
        </tr>
    );
}
