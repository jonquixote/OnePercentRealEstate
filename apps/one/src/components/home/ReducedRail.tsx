'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getProperties } from '@/app/actions';

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function ReducedRail() {
    const [items, setItems] = useState<any[] | null>(null);

    useEffect(() => {
        let alive = true;
        getProperties(1, 12, 'biggest_cut', { hasPriceCut: true })
            .then((d: any) => { if (alive) setItems(d?.items ?? []); })
            .catch(() => { if (alive) setItems([]); });
        return () => { alive = false; };
    }, []);

    return (
        <section aria-labelledby="reduced-headline" className="border-t border-line bg-ink">
            <div className="mx-auto max-w-6xl px-6 py-16 lg:px-8">
                <div className="flex items-baseline justify-between">
                    <div>
                        <p className="prov prov--brass mb-3 inline-block">motivated sellers</p>
                        <h2
                            id="reduced-headline"
                            style={{ font: '400 var(--display-2)/1.1 var(--font-display)' }}
                        >
                            The deepest cuts
                        </h2>
                    </div>
                    <Link
                        href="/search?hasCut=true&sort=biggest_cut"
                        className="text-[13px]"
                        style={{ color: 'var(--haze)' }}
                    >
                        All reductions →
                    </Link>
                </div>

                <div className="mt-8 divide-y" style={{ borderColor: 'var(--line)' }}>
                    {!items ? (
                        <div className="space-y-4">
                            {Array.from({ length: 5 }).map((_, i) => (
                                <div key={i} className="flex items-baseline justify-between py-4">
                                    <div className="h-5 w-16 rounded bg-[var(--ink-2)] animate-pulse" />
                                    <div className="mx-6 h-4 flex-1 rounded bg-[var(--ink-2)] animate-pulse" />
                                    <div className="h-5 w-20 rounded bg-[var(--ink-2)] animate-pulse" />
                                </div>
                            ))}
                        </div>
                    ) : items.length === 0 ? (
                        <p className="py-4 text-[14px]" style={{ color: 'var(--mute)' }}>No price cuts found.</p>
                    ) : items.map(function(p) {
                        const cut = Number(p.price_cut_pct ?? 0);
                        const price = Number(p.listing_price ?? 0);
                        return (
                            <Link
                                key={p.id}
                                href={`/property/${p.id}`}
                                className="flex items-baseline justify-between py-4 transition-colors hover:bg-[var(--ink-2)]"
                                style={{ borderColor: 'var(--line)' }}
                            >
                                <span className="figure text-[20px]" style={{ color: 'var(--brass-hi)' }}>
                                    −{(cut * 100).toFixed(cut >= 0.1 ? 0 : 1)}%
                                </span>
                                <span className="mx-6 flex-1 truncate text-[14px]" style={{ color: 'var(--haze)' }}>
                                    {p.address}
                                </span>
                                <span className="figure text-[15px]" style={{ color: 'var(--text)' }}>
                                    {price > 0 ? usd0.format(price) : '—'}
                                </span>
                            </Link>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}
