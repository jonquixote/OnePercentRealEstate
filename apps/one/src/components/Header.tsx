'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRef, useEffect } from 'react';
import { Search, BarChart3, Menu, X, Compass, Calculator, Library, Briefcase, ChevronDown } from 'lucide-react';
import UserNav from './UserNav';
import GlobalSearch from './GlobalSearch';
import { PRIMARY_LINKS, TOOL_LINKS, STRATEGY_LINKS } from '@/lib/nav';

export default function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [exploreOpen, setExploreOpen] = useState(false);
  const exploreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClickAway = (e: MouseEvent) => {
      if (exploreRef.current && !exploreRef.current.contains(e.target as Node)) {
        setExploreOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, []);

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-ink/85 backdrop-blur supports-[backdrop-filter]:bg-ink/70">
      <nav className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3 lg:px-8" aria-label="Global">
        {/* Brand */}
        <div className="flex items-center">
          <Link href="/" className="-m-1.5 p-1.5 flex items-center">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-pass font-mono text-[13px] font-bold text-white">1%</span>
            <span className="ml-3 text-lg font-display font-semibold text-foreground tracking-tight">OnePercent</span>
          </Link>
        </div>

        {/* Prominent search — header */}
        <div className="hidden md:flex flex-1 justify-center">
          <GlobalSearch variant="header" />
        </div>

        {/* Primary nav */}
        <div className="hidden lg:flex items-center gap-7">
          {PRIMARY_LINKS.slice(0, 3).map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-sm font-medium leading-6 text-haze hover:text-foreground transition-colors"
            >
              {l.label}
            </Link>
          ))}

          {/* Explore mega-menu */}
          <div className="relative" ref={exploreRef}>
            <button
              type="button"
              onClick={() => setExploreOpen((v) => !v)}
              aria-expanded={exploreOpen}
              className="flex items-center gap-1 text-sm font-medium leading-6 text-haze hover:text-foreground transition-colors"
            >
              <Compass className="h-4 w-4" />
              Explore
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${exploreOpen ? 'rotate-180' : ''}`} />
            </button>
            {exploreOpen && (
              <div
                onKeyDown={(e) => { if (e.key === 'Escape') setExploreOpen(false); }}
                className="absolute right-0 top-full mt-2 w-[520px] rounded-xl border border-line bg-card/95 backdrop-blur shadow-[0_24px_60px_-20px_rgba(42,37,32,0.20)] p-6 grid grid-cols-3 gap-6"
              >
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-3">Tools</p>
                  <ul className="space-y-2">
                    {TOOL_LINKS.map((l) => (
                      <li key={l.href}>
                        <Link href={l.href} onClick={() => setExploreOpen(false)} className="text-sm text-foreground hover:text-pass transition-colors">{l.label}</Link>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="col-span-2">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-3">Strategy</p>
                  <ul className="space-y-2">
                    {STRATEGY_LINKS.map((l) => (
                      <li key={l.href}>
                        <Link href={l.href} onClick={() => setExploreOpen(false)} className="text-sm text-foreground hover:text-pass transition-colors">{l.label}</Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>

          <Link href="/pricing" className="text-sm font-semibold leading-6 text-brass-hi hover:text-brass transition-colors">
            Pricing
          </Link>
        </div>

        {/* User nav — single instance, hoisted so responsive blocks don't duplicate */}
        <div className="hidden lg:flex items-center">
          <UserNav />
        </div>

        {/* Mobile toggle */}
        <div className="flex lg:hidden ml-auto items-center gap-3">
          <div className="lg:hidden"><UserNav /></div>
          <button
            type="button"
            onClick={() => setMobileOpen(!mobileOpen)}
            className="-m-2.5 inline-flex items-center justify-center rounded-md p-2.5 text-haze hover:text-foreground"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </nav>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden border-t border-line bg-card">
          <div className="p-4">
            <GlobalSearch variant="header" className="w-full" />
          </div>
          <div className="space-y-1 px-4 pb-4">
            {[...PRIMARY_LINKS, ...TOOL_LINKS, ...STRATEGY_LINKS].map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setMobileOpen(false)}
                className="block rounded-md px-3 py-2 text-base font-medium text-foreground hover:bg-ink-2 hover:text-pass"
              >
                {l.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
