'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { usePrefs, parsePrefs } from '@/lib/prefs';
import { METROS } from '@/lib/metros';

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
  stripeCustomerId: string | null;
}

export default function AccountPage() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [billingBusy, setBillingBusy] = useState(false);

  async function openBillingPortal() {
    setBillingBusy(true);
    try {
      const res = await fetch('/api/checkout/portal', { method: 'POST' });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (!res.ok) {
        setBillingBusy(false);
        return;
      }
      const data = await res.json();
      if (data?.url) window.location.href = data.url;
      else setBillingBusy(false);
    } catch {
      setBillingBusy(false);
    }
  }

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
        <div className="mx-auto max-w-4xl px-6 py-16">
          <p style={{ color: 'var(--haze)' }}>Loading…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-ink">
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
          {user.stripeCustomerId && (
            <button
              onClick={openBillingPortal}
              disabled={billingBusy}
              className="text-[12px] font-medium transition-colors hover:opacity-70 disabled:opacity-50"
              style={{ color: 'var(--brass-hi)' }}
            >
              {billingBusy ? 'Loading…' : 'Manage billing →'}
            </button>
          )}
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

          {/* Watched searches */}
          <section>
            <h2 className="prov mb-4 inline-block">watched searches</h2>
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

        {/* Presets */}
        <PresetsEditor />
      </div>
    </div>
  );
}

function PresetsEditor() {
  const { prefs, save, loading } = usePrefs();
  const [draft, setDraft] = useState(prefs);
  const [saved, setSaved] = useState(false);
  const [label, setLabel] = useState('');
  const [zip, setZip] = useState('');
  const seeded = useRef(false);
  const touched = useRef(false);

  // Seed local draft once when prefs resolve. If the user has already touched
  // any field, their edits win and we never clobber them with a late response.
  // Any edit marks the form touched so a late prefs response can't clobber it.
  const patch = (fn: (d: typeof draft) => typeof draft) => {
    touched.current = true;
    setDraft(fn);
  };

  useEffect(() => {
    if (!loading && !seeded.current && !touched.current) {
      seeded.current = true;
      setDraft(prefs);
    }
  }, [loading, prefs]);

  async function persist() {
    const cleaned = parsePrefs(draft);
    setDraft(cleaned);
    const ok = await save(cleaned);
    setSaved(ok);
    if (ok) setTimeout(() => setSaved(false), 1500);
  }

  function addArea(mLabel: string, mZip: string) {
    if (!/^\d{5}$/.test(mZip) || !mLabel.trim()) return;
    patch((d) => ({ ...d, areas: [...d.areas, { label: mLabel.trim(), zip: mZip }] }));
    setLabel('');
    setZip('');
  }

  function removeArea(i: number) {
    patch((d) => ({ ...d, areas: d.areas.filter((_, idx) => idx !== i) }));
  }

  return (
    <section id="presets" className="mt-12 scroll-mt-32">
      <h2 className="prov mb-4 inline-block">investor presets</h2>
      <div className="rounded-[var(--r-panel)] border border-line bg-card p-6">
        <p className="text-[14px] text-haze mb-5">Defaults that pre-fill the calculator, valuation, and search areas. Manual edits always win for the session.</p>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <NumField label="Rate %" value={draft.financing.ratePct} step={0.1} onChange={(v) => patch((d) => ({ ...d, financing: { ...d.financing, ratePct: v } }))} />
          <NumField label="Down %" value={draft.financing.downPct} step={1} onChange={(v) => patch((d) => ({ ...d, financing: { ...d.financing, downPct: v } }))} />
          <NumField label="Term (yrs)" value={draft.financing.termYears} step={1} onChange={(v) => patch((d) => ({ ...d, financing: { ...d.financing, termYears: v } }))} />
          <NumField label="Tax %" value={draft.financing.taxRatePct ?? null} step={0.1} onChange={(v) => patch((d) => ({ ...d, financing: { ...d.financing, taxRatePct: v } }))} onClear={() => patch((d) => ({ ...d, financing: { ...d.financing, taxRatePct: null } }))} />
          <NumField label="Insurance $/yr" value={draft.financing.insuranceMoYr ?? null} step={50} onChange={(v) => patch((d) => ({ ...d, financing: { ...d.financing, insuranceMoYr: v } }))} onClear={() => patch((d) => ({ ...d, financing: { ...d.financing, insuranceMoYr: null } }))} />
          <NumField label="Mgmt %" value={draft.financing.mgmtPct} step={1} onChange={(v) => patch((d) => ({ ...d, financing: { ...d.financing, mgmtPct: v } }))} />
          <NumField label="Vacancy %" value={draft.financing.vacancyPct} step={1} onChange={(v) => patch((d) => ({ ...d, financing: { ...d.financing, vacancyPct: v } }))} />
        </div>

        <div className="mt-4">
          <p className="prov mb-2">strategy</p>
          <div className="flex flex-wrap gap-2">
            {(['buy_hold', 'brrrr', 'flip', 'str'] as const).map((s) => (
              <button
                key={s}
                onClick={() => patch((d) => ({ ...d, strategy: s }))}
                className={`rounded-full border px-4 py-1.5 text-xs font-semibold capitalize transition-colors ${
                  draft.strategy === s ? 'border-pass bg-pass/10 text-pass' : 'border-line text-haze hover:text-foreground'
                }`}
              >
                {s.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        {/* Watched areas */}
        <div className="mt-5">
          <p className="prov mb-2">watched areas</p>
          <div className="flex flex-wrap gap-2">
            {draft.areas.map((a, i) => (
              <span key={`${a.zip}-${i}`} className="inline-flex items-center gap-1 rounded-full border border-line bg-ink-2 px-3 py-1 text-xs">
                {a.label} <span className="text-haze">{a.zip}</span>
                <button onClick={() => removeArea(i)} className="text-loss" aria-label={`Remove ${a.label}`}>×</button>
              </span>
            ))}
            {draft.areas.length === 0 && <span className="text-xs text-mute">No areas yet — add below or pick a metro.</span>}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label (e.g. Houston)"
              className="w-40 rounded-xl border border-line bg-ink-2 px-3 py-2 text-sm outline-none focus:border-pass/50"
            />
            <input
              value={zip}
              onChange={(e) => setZip(e.target.value)}
              placeholder="ZIP"
              maxLength={5}
              className="w-20 rounded-xl border border-line bg-ink-2 px-3 py-2 text-sm tabular-nums outline-none focus:border-pass/50"
            />
            <button onClick={() => addArea(label, zip)} className="rounded-full border border-pass px-4 py-2 text-xs font-semibold text-pass hover:bg-pass/10">Add</button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {METROS.map((m) => (
              <button
                key={m.zip}
                onClick={() => addArea(m.label, m.zip)}
                className="rounded-full border border-line px-3 py-1 text-xs text-haze hover:text-foreground transition-colors"
              >
                + {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={persist}
            className="rounded-full bg-pass px-6 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Save presets
          </button>
          {saved && <span className="prov prov--real">saved ✓</span>}
        </div>
      </div>
    </section>
  );
}

function NumField<T extends number | null>({ label, value, step, onChange, onClear }: { label: string; value: T; step: number; onChange: (v: T) => void; onClear?: () => void }) {
  return (
    <label className="block">
      <span className="text-xs text-haze mb-1 flex items-center justify-between">
        <span>{label}</span>
        {onClear && (
          <button type="button" onClick={onClear} className="text-[10px] uppercase tracking-wide text-haze hover:text-pass" title="Use market default">
            clear
          </button>
        )}
      </span>
      <input
        type="number"
        step={step}
        value={Number.isFinite(value as number) ? (value as number) : ''}
        onChange={(e) => onChange((e.target.value === '' ? null : Number(e.target.value)) as T)}
        className="w-full rounded-xl border border-line bg-ink-2 px-3 py-2 text-sm tabular-nums outline-none focus:border-pass/50"
      />
    </label>
  );
}
