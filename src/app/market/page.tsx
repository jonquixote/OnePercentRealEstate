'use client';

import Link from 'next/link';
import { Search, Map as MapIcon, ArrowRight } from 'lucide-react';

export default function MarketLandingPage() {
    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
            <div className="max-w-2xl text-center space-y-8">
                <div className="mx-auto h-24 w-24 rounded-full bg-slate-900 flex items-center justify-center shadow-2xl ring-4 ring-emerald-500/20">
                    <MapIcon className="h-10 w-10 text-white" />
                </div>

                <div className="space-y-4">
                    <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-6xl">
                        Explore Markets
                    </h1>
                    <p className="text-lg leading-8 text-slate-600">
                        Drill down into specific zip codes to see rent-to-price ratios, HUD FMR benchmarks, and detailed investment metrics.
                    </p>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                    <Link
                        href="/search"
                        className="w-full sm:w-auto inline-flex items-center justify-center rounded-full bg-slate-900 px-8 py-3.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-600 transition-all hover:scale-105"
                    >
                        <Search className="-ml-0.5 mr-2 h-4 w-4" aria-hidden="true" />
                        Find a Market
                    </Link>
                    <Link
                        href="/"
                        className="w-full sm:w-auto inline-flex items-center justify-center rounded-full bg-white px-8 py-3.5 text-sm font-semibold text-slate-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 transition-all hover:scale-105"
                    >
                        Return Home <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                </div>

                <p className="text-xs text-gray-500 mt-12">
                    Try searching for <span className="font-mono bg-gray-200 px-1 py-0.5 rounded">44102</span> or <span className="font-mono bg-gray-200 px-1 py-0.5 rounded">44111</span> to see live examples.
                </p>
            </div>
        </div>
    );
}
