'use client';

import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import Link from 'next/link';

interface SavedSearch {
  id: number;
  user_id: string;
  name: string;
  params: Record<string, string>;
  created_at: string;
}

interface Watchlist {
  id: number;
  name: string;
  query_json: Record<string, unknown>;
  created_at: string;
  last_evaluated_at: string | null;
}

interface SessionUser {
  id: string;
  email: string;
  tier: 'free' | 'pro';
}

export default function AccountPage() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [meRes, searchesRes, watchlistsRes] = await Promise.all([
          fetch('/api/auth/me'),
          fetch('/api/saved-searches'),
          fetch('/api/watchlists'),
        ]);
        const me = await meRes.json();
        if (me.user) setUser(me.user);
        if (searchesRes.ok) {
          const data = await searchesRes.json();
          setSavedSearches(data ?? []);
        }
        if (watchlistsRes.ok) {
          const data = await watchlistsRes.json();
          setWatchlists(data ?? []);
        }
      } catch (err) {
        console.error('Failed to load account data', err);
      }
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-ink">
        <Header />
        <div className="mx-auto max-w-4xl px-6 py-16">
          <p style={{ color: 'var(--haze)' }}>Loading…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-ink">
        <Header />
        <div className="mx-auto max-w-4xl px-6 py-16 text-center">
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--text)' }}>Sign in to view your account</h1>
          <p className="mt-2" style={{ color: 'var(--haze)' }}>
            <Link href="/login" style={{ color: 'var(--pass-hi)' }}>Sign in</Link> to manage your saved searches and watchlists.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: 'var(--ink)', color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>
      <Header />
      <div className="mx-auto max-w-4xl px-6 py-16">
        {/* Profile header */}
        <header className="flex items-baseline justify-between pb-8" style={{ borderBottom: '1px solid var(--line)' }}>
          <div>
            <h1 className="text-2xl font-semibold" style={{ font: '400 var(--display-2)/1.1 var(--font-display)' }}>Account</h1>
            <p className="mt-1 text-[14px]" style={{ color: 'var(--haze)' }}>{user.email}</p>
          </div>
          <span className={`prov ${user.tier === 'pro' ? 'prov--real' : 'prov--est'}`}>
            {user.tier === 'pro' ? 'Pro' : 'Free'}
          </span>
        </header>

        <div className="mt-10 grid grid-cols-1 gap-12 lg:grid-cols-2">
          {/* Saved searches */}
          <section>
            <h2 className="prov mb-4 inline-block">saved searches</h2>
            {savedSearches.length === 0 ? (
              <p className="text-[14px]" style={{ color: 'var(--mute)' }}>
                No saved searches yet.{' '}
                <Link href="/" style={{ color: 'var(--pass-hi)' }}>Browse properties</Link> and save a search to get started.
              </p>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--line)' }}>
                {savedSearches.map((s) => (
                  <div key={s.id} className="flex items-center justify-between py-3">
                    <div>
                      <p className="text-[14px] font-medium">{s.name}</p>
                      <p className="text-[12px]" style={{ color: 'var(--mute)' }}>
                        {new Date(s.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="prov prov--est">{Object.keys(s.params || {}).length} filters</span>
                      <button
                        onClick={async () => {
                          const res = await fetch(`/api/saved-searches?id=${s.id}`, { method: 'DELETE' });
                          if (res.ok) setSavedSearches(prev => prev.filter(x => x.id !== s.id));
                        }}
                        className="text-[12px] font-medium transition-colors hover:opacity-70"
                        style={{ color: 'var(--loss)' }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Watchlists */}
          <section>
            <h2 className="prov mb-4 inline-block">watchlists</h2>
            {watchlists.length === 0 ? (
              <p className="text-[14px]" style={{ color: 'var(--mute)' }}>
                No watchlists yet. Set up a watchlist to get alerted about new matching properties.
              </p>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--line)' }}>
                {watchlists.map((w) => (
                  <div key={w.id} className="flex items-center justify-between py-3">
                    <div>
                      <p className="text-[14px] font-medium">{w.name}</p>
                      <p className="text-[12px]" style={{ color: 'var(--mute)' }}>
                        Created {new Date(w.created_at).toLocaleDateString()}
                        {w.last_evaluated_at ? ` · last checked ${new Date(w.last_evaluated_at).toLocaleDateString()}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="prov prov--est">
                        {Object.keys(w.query_json || {}).length} conditions
                      </span>
                      <button
                        onClick={async () => {
                          const res = await fetch(`/api/watchlists?id=${w.id}`, { method: 'DELETE' });
                          if (res.ok) setWatchlists(prev => prev.filter(x => x.id !== w.id));
                        }}
                        className="text-[12px] font-medium transition-colors hover:opacity-70"
                        style={{ color: 'var(--loss)' }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
