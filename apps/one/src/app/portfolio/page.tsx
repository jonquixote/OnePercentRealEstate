'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Heart, Search, Trash2 } from 'lucide-react';

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

export default function PortfolioPage() {
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [wRes, sRes] = await Promise.all([
          fetch('/api/watchlists'),
          fetch('/api/saved-searches'),
        ]);
        if (wRes.status === 401 || sRes.status === 401) {
          // Not authenticated — show sign-in prompt
          setLoading(false);
          return;
        }
        if (wRes.ok) {
          const wData = await wRes.json();
          setWatchlists(Array.isArray(wData) ? wData : []);
        }
        if (sRes.ok) {
          const sData = await sRes.json();
          setSavedSearches(Array.isArray(sData) ? sData : []);
        }
      } catch {
        // Network error — show generic error, not sign-in prompt
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

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--pass)' }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <header className="mb-10">
          <h1 className="display-1 mb-2">Portfolio</h1>
          <p className="text-[15px] text-haze">Your watchlists and saved searches, all in one place.</p>
        </header>

        {/* Watchlists */}
        <section className="mb-12">
          <h2 className="prov mb-5 inline-block">watchlists</h2>
          {watchlists.length > 0 ? (
            <div className="space-y-3">
              {watchlists.map((w) => (
                <div key={w.id} className="flex items-center justify-between rounded-[var(--r-panel)] border border-line bg-card p-4">
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
            </div>
          ) : (
            <div className="rounded-[var(--r-panel)] border border-line bg-card p-8 text-center">
              <Heart className="mx-auto h-8 w-8 text-haze mb-3" />
              <p className="text-sm text-haze mb-4">No watchlists yet. Save a search to track it here.</p>
              <Link
                href="/search"
                className="inline-flex items-center gap-2 rounded-full border border-pass px-6 py-2 text-sm font-semibold text-pass transition-colors hover:bg-pass/10"
              >
                <Search className="h-4 w-4" />
                Browse Properties
              </Link>
            </div>
          )}
        </section>

        {/* Saved Searches */}
        <section>
          <h2 className="prov mb-5 inline-block">saved searches</h2>
          {savedSearches.length > 0 ? (
            <div className="space-y-3">
              {savedSearches.map((s) => {
                const params = new URLSearchParams(s.params);
                return (
                  <Link
                    key={s.id}
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
              <p className="text-sm text-haze">Use the search page with your preferred filters and save the query to access it here later.</p>
            </div>
          )}
        </section>

        {/* Call to action */}
        <div className="mt-12 rounded-[var(--r-panel)] bg-ink-2 border border-line p-6 text-center">
          <p className="text-sm text-haze mb-4">Sign in to sync your portfolio across devices and set up email alerts for new listings.</p>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-full bg-pass px-6 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}
