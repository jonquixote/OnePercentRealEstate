'use client';

import { use } from 'react';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useProperties, type PropertyListItem } from '@oper/api-client';

type Property = PropertyListItem;

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function formatPercent(val: number): string {
    return `${(val * 100).toFixed(2)}%`;
}

export default function ComparePage({ searchParams }: { searchParams: Promise<{ ids: string }> }) {
    const params = use(searchParams);
    const ids = params.ids ? params.ids.split(',').filter(Boolean) : [];
    const { data, isLoading } = useProperties(ids);
    const properties: Property[] = data ?? [];

    if (isLoading) {
        return (
            <div className="flex h-screen items-center justify-center" style={{ background: 'var(--ink)' }}>
                <Loader2 className="h-8 w-8 animate-spin" style={{ color: 'var(--pass)' }} />
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
                                <th className="p-4 text-left text-[13px] font-semibold w-48" style={{ color: 'var(--haze)', background: 'var(--ink-2)' }}>Feature</th>
                                {properties.map(p => (
                                    <th key={p.id} className="p-4 text-left min-w-[250px]" style={{ borderLeft: '1px solid var(--line)', background: 'var(--ink-2)' }}>
                                        <div>
                                            {p.images && p.images.length > 0 ? (
                                                <div className="mat"><img src={p.images[0]} alt={p.address} className="h-32 w-full rounded-[var(--r-mat)] object-cover" style={{ border: '1px solid var(--line)' }} /></div>
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
                                    style={{ color: 'var(--mute)', background: 'var(--ink-2)' }}>Financials</td>
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

                            {/* Specs Section */}
                            <tr>
                                <td className="p-2 px-4 text-[10px] font-bold uppercase tracking-wider" colSpan={properties.length + 1}
                                    style={{ color: 'var(--mute)', background: 'var(--ink-2)' }}>Property Specs</td>
                            </tr>
                            <TableRow label="Bedrooms" properties={properties} render={(p) => String(p.financial_snapshot?.bedrooms ?? '-')} />
                            <TableRow label="Bathrooms" properties={properties} render={(p) => String(p.financial_snapshot?.bathrooms ?? '-')} />
                            <TableRow label="Sqft" properties={properties} render={(p) => p.financial_snapshot?.sqft?.toLocaleString() ?? '-'} />
                            <TableRow label="Year Built" properties={properties} render={(p) => String(p.financial_snapshot?.year_built ?? '-')} />

                            {/* Additional Data */}
                            <tr>
                                <td className="p-2 px-4 text-[10px] font-bold uppercase tracking-wider" colSpan={properties.length + 1}
                                    style={{ color: 'var(--mute)', background: 'var(--ink-2)' }}>Additional Data</td>
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
            <td className="p-4 text-[14px] font-medium" style={{ color: 'var(--haze)' }}>{label}</td>
            {properties.map(p => (
                <td key={p.id} className="p-4 text-[14px]" style={{ borderLeft: '1px solid var(--line)' }}>
                    {render(p)}
                </td>
            ))}
        </tr>
    );
}
