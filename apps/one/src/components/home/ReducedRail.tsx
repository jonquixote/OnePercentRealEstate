'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowDownRight } from 'lucide-react';
import { getProperties } from '@/app/actions';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/**
 * Wave 5 (W4 leftover) — "Reduced this week" rail: the biggest standard-
 * inventory price cuts, served by the idx_listings_price_cut partial index
 * (1.5 ms sort). Horizontal scroll of compact tiles; hidden entirely when
 * no cuts exist yet.
 */
export function ReducedRail() {
    const [items, setItems] = useState<any[] | null>(null);

    useEffect(() => {
        let alive = true;
        getProperties(1, 12, 'biggest_cut', { hasPriceCut: true })
            .then((d: any) => { if (alive) setItems(d?.items ?? []); })
            .catch(() => { if (alive) setItems([]); });
        return () => { alive = false; };
    }, []);

    if (!items || items.length === 0) return null;

    return (
        <section aria-labelledby="reduced-headline" className="border-t border-line bg-ink">
            <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
                <div className="flex items-baseline justify-between">
                    <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brass-hi">Motivated sellers</p>
                        <h2 id="reduced-headline" className="mt-1.5 font-sans text-[clamp(22px,2.5vw,28px)] font-semibold tracking-[-0.02em] text-white">
                            Biggest price cuts
                        </h2>
                    </div>
                    <Link href="/?cut=true" className="text-sm font-medium text-haze hover:text-white transition-colors">
                        See all →
                    </Link>
                </div>

                <div className="mt-6 flex gap-4 overflow-x-auto pb-2 [scrollbar-width:thin]">
                    {items.map((p) => {
                        const cut = Number(p.price_cut_pct ?? 0);
                        const price = Number(p.listing_price ?? 0);
                        return (
                            <Link
                                key={p.id}
                                href={`/property/${p.id}`}
                                className="group w-56 flex-shrink-0 rounded-xl border border-line bg-ink-panel p-4 transition-colors hover:border-zinc-600"
                            >
                                <span className="inline-flex items-center gap-1 rounded-full bg-brass px-2 py-0.5 text-[11px] font-bold text-zinc-950">
                                    <ArrowDownRight className="h-3 w-3" aria-hidden="true" />
                                    −{(cut * 100).toFixed(cut >= 0.1 ? 0 : 1)}%
                                </span>
                                <p className="mt-2 text-lg font-semibold tabular-nums text-white">{price > 0 ? money.format(price) : '—'}</p>
                                <p className="mt-0.5 line-clamp-2 text-xs text-haze">{p.address}</p>
                            </Link>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}
