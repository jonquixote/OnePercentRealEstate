'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Search, TrendingUp, BarChart3, Menu, X } from 'lucide-react';
import UserNav from './UserNav';

export default function Header() {
    const [mobileOpen, setMobileOpen] = useState(false);

    return (
        <header className="bg-ink/90 border-b border-line sticky top-0 z-50 backdrop-blur">
            <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 lg:px-8" aria-label="Global">
                <div className="flex lg:flex-1">
                    <Link href="/" className="-m-1.5 p-1.5 flex items-center">
                        <span className="grid h-8 w-8 place-items-center rounded-lg bg-pass font-mono text-[13px] font-bold text-white">1%</span>
                        <span className="ml-3 text-lg font-semibold text-white tracking-tight">OnePercent</span>
                    </Link>
                </div>

                <div className="hidden lg:flex lg:gap-x-10">
                    <Link href="/search" className="text-sm font-medium leading-6 text-haze hover:text-white flex items-center gap-2 transition-colors">
                        <Search className="h-4 w-4" />
                        Search Properties
                    </Link>
                    <Link href="/analytics" className="text-sm font-medium leading-6 text-haze hover:text-white flex items-center gap-2 transition-colors">
                        <BarChart3 className="h-4 w-4" />
                        Analytics
                    </Link>
                    <Link href="/pricing" className="text-sm font-medium leading-6 text-brass-hi hover:text-white transition-colors">
                        Pricing
                    </Link>
                </div>

                <div className="hidden lg:flex flex-1 justify-end items-center">
                    <UserNav />
                </div>

                <div className="flex lg:hidden items-center gap-3">
                    <UserNav />
                    <button
                        type="button"
                        onClick={() => setMobileOpen(!mobileOpen)}
                        className="-m-2.5 inline-flex items-center justify-center rounded-md p-2.5 text-haze hover:text-white"
                        aria-label={mobileOpen ? "Close menu" : "Open menu"}
                        aria-expanded={mobileOpen}
                    >
                        {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
                    </button>
                </div>
            </nav>

            {mobileOpen && (
                <div className="lg:hidden border-t border-line bg-ink-panel">
                    <div className="space-y-1 px-6 pb-4 pt-2">
                        <Link
                            href="/search"
                            onClick={() => setMobileOpen(false)}
                            className="block rounded-md px-3 py-2 text-base font-medium leading-7 text-haze hover:bg-white/[0.05] hover:text-white flex items-center gap-2"
                        >
                            <Search className="h-4 w-4" />
                            Search Properties
                        </Link>
                        <Link
                            href="/analytics"
                            onClick={() => setMobileOpen(false)}
                            className="block rounded-md px-3 py-2 text-base font-medium leading-7 text-haze hover:bg-white/[0.05] hover:text-white flex items-center gap-2"
                        >
                            <BarChart3 className="h-4 w-4" />
                            Analytics
                        </Link>
                        <Link
                            href="/pricing"
                            onClick={() => setMobileOpen(false)}
                            className="block rounded-md px-3 py-2 text-base font-medium leading-7 text-brass-hi hover:bg-white/[0.05] hover:text-white"
                        >
                            Pricing
                        </Link>
                    </div>
                </div>
            )}
        </header>
    );
}
