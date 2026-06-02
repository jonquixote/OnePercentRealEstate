'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Search, TrendingUp, BarChart3, Menu, X } from 'lucide-react';
import UserNav from './UserNav';

export default function Header() {
    const [mobileOpen, setMobileOpen] = useState(false);

    return (
        <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-50">
            <nav className="mx-auto flex max-w-7xl items-center justify-between p-6 lg:px-8" aria-label="Global">
                <div className="flex lg:flex-1">
                    <Link href="/" className="-m-1.5 p-1.5 flex items-center">
                        <TrendingUp className="h-8 w-8 text-emerald-400" />
                        <span className="ml-3 text-xl font-bold text-white tracking-tight">1% Real Estate</span>
                    </Link>
                </div>

                <div className="hidden lg:flex lg:gap-x-12">
                    <Link href="/search" className="text-sm font-semibold leading-6 text-gray-300 hover:text-white flex items-center gap-2 transition-colors">
                        <Search className="h-4 w-4" />
                        Acquire Data
                    </Link>
                    <Link href="/analytics" className="text-sm font-semibold leading-6 text-gray-300 hover:text-white flex items-center gap-2 transition-colors">
                        <BarChart3 className="h-4 w-4" />
                        Analytics
                    </Link>
                    <Link href="/pricing" className="text-sm font-semibold leading-6 text-amber-400 hover:text-amber-300 transition-colors">
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
                        className="-m-2.5 inline-flex items-center justify-center rounded-md p-2.5 text-gray-300 hover:text-white"
                        aria-label={mobileOpen ? "Close menu" : "Open menu"}
                        aria-expanded={mobileOpen}
                    >
                        {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
                    </button>
                </div>
            </nav>

            {mobileOpen && (
                <div className="lg:hidden border-t border-slate-800 bg-slate-900">
                    <div className="space-y-1 px-6 pb-4 pt-2">
                        <Link
                            href="/search"
                            onClick={() => setMobileOpen(false)}
                            className="block rounded-md px-3 py-2 text-base font-semibold leading-7 text-gray-300 hover:bg-slate-800 hover:text-white flex items-center gap-2"
                        >
                            <Search className="h-4 w-4" />
                            Acquire Data
                        </Link>
                        <Link
                            href="/analytics"
                            onClick={() => setMobileOpen(false)}
                            className="block rounded-md px-3 py-2 text-base font-semibold leading-7 text-gray-300 hover:bg-slate-800 hover:text-white flex items-center gap-2"
                        >
                            <BarChart3 className="h-4 w-4" />
                            Analytics
                        </Link>
                        <Link
                            href="/pricing"
                            onClick={() => setMobileOpen(false)}
                            className="block rounded-md px-3 py-2 text-base font-semibold leading-7 text-amber-400 hover:bg-slate-800 hover:text-amber-300"
                        >
                            Pricing
                        </Link>
                    </div>
                </div>
            )}
        </header>
    );
}
