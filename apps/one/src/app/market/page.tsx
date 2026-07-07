'use client';

import Link from 'next/link';
import { Search } from 'lucide-react';

export default function MarketLandingPage() {
    return (
        <div style={{ background: 'var(--ink)', color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>
            <div className="mx-auto flex min-h-[80vh] max-w-2xl items-center justify-center px-6 text-center">
                <div className="space-y-8">
                    <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full" style={{ background: 'var(--ink-panel)', border: '1px solid var(--line)' }}>
                        <Search className="h-10 w-10" style={{ color: 'var(--pass-hi)' }} />
                    </div>

                    <div className="space-y-4">
                        <h1 style={{ font: '300 var(--display-1)/1.05 var(--font-display)' }}>
                            Explore Markets
                        </h1>
                        <p className="mx-auto max-w-md text-[15px] leading-relaxed" style={{ color: 'var(--haze)' }}>
                            Drill down into specific zip codes to see rent-to-price ratios, HUD FMR benchmarks, and detailed investment metrics.
                        </p>
                    </div>

                    <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
                        <Link
                            href="/search"
                            className="inline-flex items-center gap-2 rounded-full px-8 py-3.5 text-[14px] font-semibold transition-colors"
                            style={{ background: 'var(--pass)', color: '#fff' }}
                        >
                            <Search className="h-4 w-4" aria-hidden="true" />
                            Find a Market
                        </Link>
                        <Link
                            href="/"
                            className="inline-flex items-center gap-2 rounded-full border px-8 py-3.5 text-[14px] font-semibold transition-colors"
                            style={{ borderColor: 'var(--line)', color: 'var(--haze)' }}
                        >
                            Return Home
                        </Link>
                    </div>

                    <p className="text-[12px]" style={{ color: 'var(--mute)' }}>
                        Try searching for <span className="rounded px-1 py-0.5 font-mono" style={{ background: 'var(--ink-2)' }}>44102</span> or{' '}
                        <span className="rounded px-1 py-0.5 font-mono" style={{ background: 'var(--ink-2)' }}>44111</span>{' '}
                        to see live examples.
                    </p>
                </div>
            </div>
        </div>
    );
}
