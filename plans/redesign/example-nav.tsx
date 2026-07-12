/**
 * example-nav.tsx — the IA rendered: header (both auth states), footer,
 * mobile sheet, breadcrumbs. Self-contained; inline mock state.
 *
 * Design notes:
 * - The active-route indicator is a 2px --pass segment sitting ON the
 *   header's bottom hairline: the brand's "line" doing navigation work.
 * - Exactly four primary destinations (jobs), one brass affordance
 *   (Pricing), one keycap (⌘K). Nothing else earns header space.
 * - Shelf badge = sum of new_matches across saved searches.
 */
'use client';

import { useState } from 'react';

const DESTINATIONS = [
  { href: '/search', label: 'Search' },
  { href: '/market', label: 'Markets' },
  { href: '/shelf', label: 'Shelf', badge: 3 },
  { href: '/playbook', label: 'Playbook' },
];

const FOOTER = {
  product: [
    { href: '/search', label: 'Search' },
    { href: '/market', label: 'Markets' },
    { href: '/shelf', label: 'Shelf' },
    { href: '/playbook', label: 'Playbook' },
    { href: '/pricing', label: 'Pricing' },
    { href: 'https://two.octavo.press', label: 'Terminal ↗' },
  ],
  markets: [
    ['Los Angeles', '/market/90004'], ['Houston', '/market/77002'],
    ['Atlanta', '/market/30310'], ['Tampa', '/market/33604'],
    ['Columbus', '/market/43206'], ['Memphis', '/market/38106'],
    ['Cleveland', '/market/44102'], ['San Antonio', '/market/78201'],
  ],
  method: [
    { href: '/playbook', label: 'The 1% rule' },
    { href: '/playbook/buy-hold', label: 'Buy & hold' },
    { href: '/playbook/brrrr', label: 'BRRRR' },
    { href: '/playbook/calculator', label: 'Deal calculator' },
    { href: '/playbook/model', label: 'How the model works' },
  ],
};

export default function ExampleNav() {
  const [signedIn, setSignedIn] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const active = '/search';

  return (
    <div style={{ background: 'var(--ink)', color: 'var(--text)', fontFamily: 'var(--font-ui)', minHeight: '100vh' }}>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 backdrop-blur" style={{ background: 'rgba(250,247,242,.85)', borderBottom: '1px solid var(--line)' }}>
        <nav className="mx-auto flex h-14 max-w-7xl items-center gap-8 px-6 lg:px-8" aria-label="Global">

          {/* wordmark: the line runs through the diamond */}
          <a href="/" className="flex items-center gap-2" aria-label="OnePercent home">
            <span aria-hidden className="relative inline-flex h-4 w-4 items-center">
              <span className="absolute inset-x-0 top-1/2 h-px" style={{ background: 'var(--pass)' }} />
              <span className="mx-auto h-2.5 w-2.5 rotate-45 border" style={{ borderColor: 'var(--text)', background: 'var(--ink)' }} />
            </span>
            <span className="text-[15px] font-semibold tracking-tight">OnePercent</span>
          </a>

          {/* four destinations; active = pass segment on the hairline */}
          <div className="relative hidden h-full items-center gap-7 lg:flex">
            {DESTINATIONS.map((d) => {
              const isActive = d.href === active;
              return (
                <a
                  key={d.href}
                  href={d.href}
                  aria-current={isActive ? 'page' : undefined}
                  className="relative flex h-full items-center gap-1.5 text-[14px] font-medium transition-colors"
                  style={{ color: isActive ? 'var(--text)' : 'var(--haze)' }}
                >
                  {d.label}
                  {d.badge ? (
                    <span className="rounded-full px-1.5 py-px text-[10px] font-bold leading-none" style={{ background: 'var(--pass)', color: 'var(--ink)' }}>
                      {d.badge}
                    </span>
                  ) : null}
                  {isActive && (
                    <span aria-hidden className="absolute inset-x-0 -bottom-px h-[2px]" style={{ background: 'var(--pass)' }} />
                  )}
                </a>
              );
            })}
          </div>

          {/* utility cluster */}
          <div className="ml-auto hidden items-center gap-3 lg:flex">
            <button
              type="button"
              className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors hover:border-line-hi"
              style={{ borderColor: 'var(--line)', color: 'var(--haze)' }}
              aria-label="Open command palette"
            >
              Search anything…
              <kbd className="rounded border px-1 font-mono text-[10px]" style={{ borderColor: 'var(--line)', color: 'var(--mute)' }}>⌘K</kbd>
            </button>

            {signedIn ? (
              <button type="button" className="flex items-center gap-2" onClick={() => setSignedIn(false)} aria-haspopup="menu" title="Account">
                <span className="flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold" style={{ background: 'var(--pass-dim)', color: 'var(--pass)' }}>
                  J
                </span>
                <span className="rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wide" style={{ background: 'var(--brass-dim)', color: 'var(--brass)' }}>
                  pro
                </span>
              </button>
            ) : (
              <>
                <a href="/pricing" className="text-[13px] font-semibold" style={{ color: 'var(--brass)' }}>Pricing</a>
                <a
                  href="/login"
                  onClick={(e) => { e.preventDefault(); setSignedIn(true); }}
                  className="rounded-full px-3.5 py-1.5 text-[13px] font-semibold"
                  style={{ background: 'var(--text)', color: 'var(--ink)' }}
                >
                  Sign in
                </a>
              </>
            )}
          </div>

          {/* mobile trigger */}
          <button type="button" className="ml-auto lg:hidden" onClick={() => setSheetOpen(true)} aria-label="Open menu">
            <span className="block h-px w-5 mb-1.5" style={{ background: 'var(--text)' }} />
            <span className="block h-px w-5 mb-1.5" style={{ background: 'var(--text)' }} />
            <span className="block h-px w-3.5" style={{ background: 'var(--text)' }} />
          </button>
        </nav>
      </header>

      {/* ── Mobile sheet ───────────────────────────────────────────── */}
      {sheetOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0" style={{ background: 'rgba(42,37,32,.3)' }} onClick={() => setSheetOpen(false)} />
          <div className="absolute inset-y-0 right-0 flex w-[84%] max-w-sm flex-col" style={{ background: 'var(--ink)', borderLeft: '1px solid var(--line)' }}>
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
              <span className="text-[15px] font-semibold">OnePercent</span>
              <button type="button" onClick={() => setSheetOpen(false)} aria-label="Close menu" className="text-[20px]" style={{ color: 'var(--haze)' }}>×</button>
            </div>
            <nav className="flex-1 overflow-y-auto px-2 py-3">
              {DESTINATIONS.map((d) => (
                <a
                  key={d.href}
                  href={d.href}
                  className="flex items-center justify-between rounded-xl px-4 py-4 text-[17px] font-medium"
                  style={d.href === active ? { background: 'var(--pass-dim)', color: 'var(--pass)' } : { color: 'var(--text)' }}
                >
                  {d.label}
                  {d.badge ? <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: 'var(--pass)', color: 'var(--ink)' }}>{d.badge}</span> : null}
                </a>
              ))}
              <div className="mx-4 my-3 h-px" style={{ background: 'var(--line)' }} />
              <a href="/pricing" className="block px-4 py-3 text-[15px] font-semibold" style={{ color: 'var(--brass)' }}>Pricing</a>
              <a href="/account" className="block px-4 py-3 text-[15px]" style={{ color: 'var(--haze)' }}>Account</a>
            </nav>
            <div className="px-6 py-4 text-[11px]" style={{ borderTop: '1px solid var(--line)', color: 'var(--mute)' }}>
              Terminal for pros → two.octavo.press
            </div>
          </div>
        </div>
      )}

      {/* ── Breadcrumbs (property-page context shown) ──────────────── */}
      <div className="mx-auto max-w-7xl px-6 pt-6 lg:px-8">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--mute)' }}>
          <a href="/" className="hover:underline" style={{ color: 'var(--haze)' }}>Home</a>
          <span aria-hidden>·</span>
          <a href="/market/90004" className="hover:underline" style={{ color: 'var(--haze)' }}>Los Angeles 90004</a>
          <span aria-hidden>·</span>
          <span style={{ color: 'var(--text)' }}>531 N Rossmore Ave</span>
        </nav>
        <p className="prov mt-8" style={{ color: 'var(--mute)' }}>
          — page content —
        </p>
      </div>

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <footer className="mt-24" style={{ borderTop: '1px solid var(--line)' }}>
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-6 py-14 sm:grid-cols-3 lg:px-8">
          <div>
            <p className="prov mb-4" style={{ color: 'var(--mute)' }}>product</p>
            <ul className="space-y-2.5 text-[13px]">
              {FOOTER.product.map((l) => (
                <li key={l.href}><a href={l.href} className="hover:underline" style={{ color: 'var(--haze)' }}>{l.label}</a></li>
              ))}
            </ul>
          </div>
          <div>
            <p className="prov mb-4" style={{ color: 'var(--mute)' }}>markets</p>
            <ul className="space-y-2.5 text-[13px]">
              {FOOTER.markets.map(([label, href]) => (
                <li key={href}><a href={href} className="hover:underline" style={{ color: 'var(--haze)' }}>{label}</a></li>
              ))}
            </ul>
          </div>
          <div>
            <p className="prov mb-4" style={{ color: 'var(--mute)' }}>method</p>
            <ul className="space-y-2.5 text-[13px]">
              {FOOTER.method.map((l) => (
                <li key={l.href}><a href={l.href} className="hover:underline" style={{ color: 'var(--haze)' }}>{l.label}</a></li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5 text-[11px] lg:px-8" style={{ borderTop: '1px solid var(--line)', color: 'var(--mute)' }}>
          <span>© 2026 OnePercent · Estimates carry bands, never promises.</span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-px w-6" style={{ background: 'var(--pass)' }} />
            the line
          </span>
        </div>
      </footer>
    </div>
  );
}
