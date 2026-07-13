'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import UserNav from './UserNav';
import GlobalSearch from './GlobalSearch';
import {
  PRIMARY_LINKS,
  TOOL_LINKS,
  STRATEGY_LINKS,
  isActivePrimary,
} from '@/lib/nav';
import { useLocalUserId } from '@/lib/useLocalUserId';
import { useSavedSearches } from '@oper/api-client';

export default function Header() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileToggleRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Live "new matches" count for the Shelf badge.
  const userId = useLocalUserId();
  const { data: searches = [] } = useSavedSearches(userId);
  const newMatches = searches.reduce((n, s) => n + (s.new_matches ?? 0), 0);

  // Lock scroll + trap focus while the mobile sheet is open.
  useEffect(() => {
    if (!mobileOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const sheet = sheetRef.current;
    const focusables = sheet?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled])',
    );
    focusables?.[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setMobileOpen(false);
        return;
      }
      if (e.key === 'Tab' && focusables && focusables.length > 0) {
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
      mobileToggleRef.current?.focus();
    };
  }, [mobileOpen]);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-ink/85 backdrop-blur supports-[backdrop-filter]:bg-ink/70">
      <nav className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-6 lg:px-8" aria-label="Global">
        {/* Brand — the line runs through the diamond */}
        <Link href="/" className="-m-1.5 p-1.5 flex items-center gap-2" aria-label="OnePercent home">
          <span aria-hidden className="relative inline-flex h-4 w-4 items-center">
            <span className="absolute inset-x-0 top-1/2 h-px bg-pass" />
            <span className="mx-auto h-2.5 w-2.5 rotate-45 border border-foreground bg-ink" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-foreground">OnePercent</span>
        </Link>

        {/* Primary nav — exactly four jobs */}
        <div className="hidden h-full items-center gap-7 lg:flex">
          {PRIMARY_LINKS.map((l) => {
            const active = isActivePrimary(pathname, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? 'page' : undefined}
                className={`relative flex h-full items-center gap-1.5 text-sm font-medium leading-6 transition-colors ${
                  active ? 'text-foreground' : 'text-haze hover:text-foreground'
                }`}
              >
                {l.label}
                {l.href === '/shelf' && newMatches > 0 && (
                  <span className="rounded-full bg-pass px-1.5 py-px text-[10px] font-bold leading-none text-ink">
                    {newMatches}
                  </span>
                )}
                {active && (
                  <span aria-hidden className="absolute inset-x-0 -bottom-px h-[2px] bg-pass" />
                )}
              </Link>
            );
          })}
        </div>

        {/* Search — header (md+) */}
        <div className="hidden flex-1 justify-center md:flex">
          <GlobalSearch variant="header" />
        </div>

        {/* Utility cluster: Pricing (brass affordance) + account */}
        <div className="ml-auto hidden items-center gap-3 lg:flex">
          <Link
            href="/pricing"
            className="text-sm font-semibold leading-6 text-brass-hi transition-colors hover:text-brass"
          >
            Pricing
          </Link>
          <UserNav />
        </div>

        {/* Mobile toggle */}
        <div className="ml-auto flex items-center gap-3 lg:hidden">
          <UserNav />
          <button
            ref={mobileToggleRef}
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            className="-m-2.5 inline-flex items-center justify-center rounded-md p-2.5 text-haze hover:text-foreground"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
            aria-controls="mobile-sheet"
          >
            {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </nav>

      {/* Mobile sheet */}
      {mobileOpen && (
        <div
          id="mobile-sheet"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          className="fixed inset-0 z-[60] lg:hidden"
          ref={sheetRef}
        >
          <div
            className="absolute inset-0 bg-[rgba(42,37,32,0.3)]"
            onClick={closeMobile}
            aria-hidden
          />
          <div className="absolute inset-y-0 right-0 flex w-[84%] max-w-sm flex-col bg-ink shadow-[0_24px_60px_-20px_rgba(42,37,32,0.30)] border-l border-line">
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <span className="text-[15px] font-semibold text-foreground">OnePercent</span>
              <button
                type="button"
                onClick={closeMobile}
                aria-label="Close menu"
                className="text-[20px] leading-none text-haze hover:text-foreground"
              >
                <X className="h-6 w-6" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Mobile">
              {PRIMARY_LINKS.map((l) => {
                const active = isActivePrimary(pathname, l.href);
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={closeMobile}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center justify-between rounded-xl px-4 py-4 text-[17px] font-medium ${
                      active ? 'bg-pass-dim text-pass' : 'text-foreground'
                    }`}
                  >
                    {l.label}
                    {l.href === '/shelf' && newMatches > 0 && (
                      <span className="rounded-full bg-pass px-2 py-0.5 text-[11px] font-bold text-ink">
                        {newMatches}
                      </span>
                    )}
                  </Link>
                );
              })}
              <div className="mx-4 my-3 h-px bg-line" />
              <Link
                href="/pricing"
                onClick={closeMobile}
                className="block px-4 py-3 text-[15px] font-semibold text-brass-hi"
              >
                Pricing
              </Link>
              <Link
                href="/account"
                onClick={closeMobile}
                className="block px-4 py-3 text-[15px] text-haze"
              >
                Account
              </Link>
              <div className="mx-4 my-3 h-px bg-line" />
              <p className="px-4 pb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Tools
              </p>
              {TOOL_LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={closeMobile}
                  className="block px-4 py-2.5 text-[14px] text-haze hover:text-foreground"
                >
                  {l.label}
                </Link>
              ))}
              <p className="px-4 pb-2 pt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Strategy
              </p>
              {STRATEGY_LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={closeMobile}
                  className="block px-4 py-2.5 text-[14px] text-haze hover:text-foreground"
                >
                  {l.label}
                </Link>
              ))}
            </nav>
            <div className="border-t border-line px-6 py-4 text-[11px] text-mute">
              Terminal for pros → two.octavo.press
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
