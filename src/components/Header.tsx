'use client';

import Link from 'next/link';
import { Search, TrendingUp, BarChart3, LayoutDashboard } from 'lucide-react';
import UserNav from './UserNav';

export default function Header() {
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

                <div className="flex flex-1 justify-end items-center">
                    <UserNav />
                </div>
            </nav>
        </header>
    );
}
