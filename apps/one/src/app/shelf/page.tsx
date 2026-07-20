'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Heart, Search, Trash2 } from 'lucide-react';
import { usePrefs } from '@/lib/prefs';
import { useSessionUser } from '@/lib/useSessionUser';
import UpgradeMoment from '@/components/UpgradeMoment';
import { COMPARE_FREE_MAX, COMPARE_PRO_MAX } from '@/lib/entitlements';

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

interface Watchlist {
  id: number;
  name: string;
  query_json: Record<string, unknown>;
  created_at: string;
}

interface SavedSearch {
  id: number;
  name: string;
  params: Record<string, string>;
  created_at: string;
}

interface SavedProperty {
  save_id: number;
  note: string | null;
  saved_at: string;
  id: string;
  address: string;
  price: number | null;
  estimated_rent: number | null;
  rent_price_ratio: number | null;
  primary_photo: string | null;
  zip_code: string | null;
  listing_status?: string | null;
  sold_price?: number | null;
  sold_date?: string | null;
}

const MAX_SELECT = 4;

const STRATEGY_LABELS: Record<string, string> = {
  buy_hold: 'Buy & Hold',
  brrr: 'BRRRR',
  flip: 'Buy & Flip',
  str: 'Short-Term',
};

export default function ShelfPage() {
  const [saves, setSaves] = useState<SavedProperty[]>([]);
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const { prefs } = usePrefs();
  const session = useSessionUser();
  const isPro = session?.tier === 'pro';

  useEffect(() => {
    async function load() {
      try {
        const [sRes, wRes, sSearchRes] = await Promise.all([
          fetch('/api/saved-properties'),
          fetch('/api/watchlists'),
          fetch('/api/saved-searches'),
        ]);
        if (sRes.status === 401 || wRes.status === 401 || sSearchRes.status === 401) {
          setLoading(false);
          return;
        }
        if (sRes.ok) {
          const data = await sRes.json();
          setSaves(Array.isArray(data) ? data : []);
        }
        if (wRes.ok) {
          const wData = await wRes.json();
          setWatchlists(Array.isArray(wData) ? wData : []);
        }
        if (sSearchRes.ok) {
          const ssData = await sSearchRes.json();
          setSavedSearches(Array.isArray(ssData) ? ssData : []);
        }
      } catch {
        // Network error — keep empty states.
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function deleteWatchlist(id: number) {
    try {
      const res = await fetch(`/api/watchlists?id=${id}`, { method: 'DELETE' });
      if (res.ok) setWatchlists((prev) => prev.filter((w) => w.id !== id));
    } catch {
      // noop
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_SELECT) return prev;
      return [...prev, id];
    });
  }

  async function removeSelected() {
    const ids = selected;
    try {
      const results = await Promise.all(
        ids.map(async (id) => {
          const saveId = saves.find((s) => s.id === id)?.save_id;
          if (saveId == null) return [id, false] as const;
          const res = await fetch(`/api/saved-properties?id=${saveId}`, { method: 'DELETE' });
          return [id, res.ok] as const;
        }),
      );
      const okIds = new Set(results.filter(([, ok]) => ok).map(([id]) => id));
      setSaves((prev) => prev.filter((s) => !okIds.has(s.id)));
      setSelected((prev) => prev.filter((id) => !okIds.has(id)));
    } catch {
      // noop
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--pass)' }} />
      </div>
    );
  }

  const compareCap = isPro ? COMPARE_PRO_MAX : COMPARE_FREE_MAX;
  // Free users select up to MAX_SELECT but can only compare COMPARE_FREE_MAX at
  // once. Keep every selection visible — never silently truncate — and gate the
  // compare action instead. `overCompareCap` drives the disabled state + CTA.
  const overCompareCap = !isPro && selected.length > COMPARE_FREE_MAX;
  const compareIds = selected.slice(0, compareCap);
  const compareHref = !overCompareCap && selected.length >= 2 ? `/compare?ids=${compareIds.join(',')}` : null;

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <header className="mb-10">
          <h1 className="display-1 mb-2">Shelf</h1>
          <p className="text-[15px] text-haze">Your saved properties, watched searches, and investor presets — all in one place.</p>
        </header>

        {/* Section 1 — Saved properties */}
        <section className="mb-12">
          <h2 className="prov mb-5 inline-block">saved properties</h2>
          {saves.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {saves.map((s) => {
                const ratio = s.rent_price_ratio != null ? s.rent_price_ratio * 100 : null;
                const badge = s.listing_status
                  ? s.listing_status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
                  : null;
                return (
                  <div key={s.id} className="flex gap-3 rounded-[var(--r-panel)] border border-line bg-card p-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${s.address}`}
                      checked={selected.includes(s.id)}
                      onChange={() => toggleSelect(s.id)}
                      className="mt-1 h-4 w-4 shrink-0 accent-[var(--pass)]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex gap-3">
                        <div className="h-16 w-20 shrink-0 overflow-hidden rounded-[6px] bg-ink-2">
                          {s.primary_photo ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={s.primary_photo} alt={s.address} className="h-full w-full object-cover" />
                          ) : null}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{s.address}</p>
                          <p className="figure mt-0.5 text-sm">{s.price ? usd0.format(s.price) : '—'}</p>
                          {ratio != null ? (
                            <p className="figure text-xs" style={{ color: ratio >= 1 ? 'var(--pass-hi)' : 'var(--brass-hi)' }}>
                              {ratio.toFixed(2)}%
                            </p>
                          ) : null}
                        </div>
                      </div>
                      {s.note ? <p className="prov mt-2 truncate">note: {s.note}</p> : null}
                      {badge ? <span className="prov mt-1 inline-block">{badge}</span> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-[var(--r-panel)] border border-line bg-card p-8 text-center">
              <Heart className="mx-auto h-8 w-8 text-haze mb-3" />
              <p className="text-sm text-haze mb-4">No saved properties yet. Tap the ♥ on any card to add it here.</p>
              <Link
                href="/search"
                className="inline-flex items-center gap-2 rounded-full border border-pass px-6 py-2 text-sm font-semibold text-pass transition-colors hover:bg-pass/10"
              >
                <Search className="h-4 w-4" />
                Browse deals →
              </Link>
            </div>
          )}
        </section>

        {/* Section 2 — Watched searches (criteria watchlists) */}
        <section className="mb-12">
          <h2 className="prov mb-5 inline-block">watched searches</h2>
          {watchlists.length > 0 || savedSearches.length > 0 ? (
            <div className="space-y-3">
              {watchlists.map((w) => (
                <div key={`w-${w.id}`} className="flex items-center justify-between rounded-[var(--r-panel)] border border-line bg-card p-4">
                  <div className="min-w-0">
                    <Link href={`/search?watchlist=${w.id}`} className="text-sm font-medium text-foreground hover:text-pass transition-colors">
                      {w.name}
                    </Link>
                    <p className="text-xs text-haze mt-0.5">Created {new Date(w.created_at).toLocaleDateString()}</p>
                  </div>
                  <button
                    onClick={() => deleteWatchlist(w.id)}
                    className="shrink-0 p-2 text-haze hover:text-loss transition-colors"
                    aria-label="Delete watchlist"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {savedSearches.map((s) => {
                const params = new URLSearchParams(s.params);
                return (
                  <Link
                    key={`s-${s.id}`}
                    href={`/search?${params.toString()}`}
                    className="flex items-center justify-between rounded-[var(--r-panel)] border border-line bg-card p-4 transition-colors hover:bg-ink-2"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">{s.name}</p>
                      <p className="text-xs text-haze mt-0.5">{s.params ? Object.keys(s.params).length : 0} filter(s)</p>
                    </div>
                    <Search className="h-4 w-4 text-haze shrink-0" />
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="rounded-[var(--r-panel)] border border-line bg-card p-8 text-center">
              <Search className="mx-auto h-8 w-8 text-haze mb-3" />
              <p className="text-sm text-haze mb-4">No watched searches yet. Save a search to track it here.</p>
              <Link
                href="/welcome"
                className="inline-flex items-center gap-2 rounded-full border border-pass px-6 py-2 text-sm font-semibold text-pass transition-colors hover:bg-pass/10"
              >
                Set up your areas →
              </Link>
            </div>
          )}
        </section>

        {/* Section 3 — Presets teaser */}
        <section className="mb-12">
          <h2 className="prov mb-5 inline-block">presets</h2>
          <div className="rounded-[var(--r-panel)] border border-line bg-card p-6">
            <p className="text-sm text-haze">
              {STRATEGY_LABELS[prefs.strategy] ?? prefs.strategy} · {prefs.financing.ratePct}% rate · {prefs.financing.downPct}% down
            </p>
            <Link
              href="/account#presets"
              className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-pass transition-colors hover:text-pass-hi"
            >
              Edit presets →
            </Link>
            {!prefs.onboarded && (
              <Link
                href="/welcome"
                className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brass transition-colors hover:text-brass-hi"
              >
                Not set up yet — 60 seconds →
              </Link>
            )}
          </div>
        </section>
      </div>

      {/* Sticky compare bar */}
      {selected.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card/95 backdrop-blur">
          <div className="mx-auto max-w-4xl px-6 py-3">
            {overCompareCap ? (
              <div className="mb-3">
                <UpgradeMoment gate="compare" />
              </div>
            ) : null}
            <div className="flex items-center justify-between">
              <span className="text-sm text-haze">{selected.length} selected (max {MAX_SELECT})</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={removeSelected}
                  className="text-sm font-medium text-loss transition-colors hover:opacity-70"
                >
                  Remove
                </button>
                {overCompareCap ? (
                  <button
                    type="button"
                    disabled
                    title="Free accounts compare up to 2 — upgrade for 4"
                    className="cursor-not-allowed rounded-full bg-pass/40 px-5 py-2 text-sm font-semibold text-white opacity-60"
                  >
                    Compare ({selected.length}) →
                  </button>
                ) : compareHref ? (
                  <Link
                    href={compareHref}
                    className="rounded-full bg-pass px-5 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                  >
                    Compare ({selected.length}) →
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
