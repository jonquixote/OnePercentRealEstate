'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

interface Props {
  id: string;
  zipCode?: string | null;
  lat?: number | null;
  lng?: number | null;
  beds?: number | null;
}

const STRATEGIES = [
  { slug: 'buy_hold', label: '1% Rule', heuristics: (p: any) => { const r = p.estimated_rent || p.rent_low || 0; const pr = p.price || 0; return pr > 0 && r / pr >= 0.008; } },
  { slug: 'brrrr', label: 'BRRRR', heuristics: (p: any) => (p.days_on_market || 90) >= 90 },
  { slug: 'flip', label: 'Buy & Flip', heuristics: (p: any) => (p.price_cut_pct || 0) > 0 },
  { slug: 'str', label: 'Short-Term', heuristics: () => true },
] as const;

export function NearbyStrategiesSection({ id, zipCode }: Props) {
  const [active, setActive] = useState('buy_hold');
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!zipCode) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const safeZip = zipCode.replace(/[^0-9-]/g, '').replace(/-+$/, '').slice(0, 10) || '00000';
    const body = JSON.stringify({ expression: `zip_code = '${safeZip}' and price > 10000`, limit: 30 });
    fetch('/api/properties/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
      .then(r => r.ok ? r.json() : { items: [] })
      .then(d => setListings(Array.isArray(d?.items) ? d.items : []))
      .catch(() => setListings([]))
      .finally(() => setLoading(false));
  }, [zipCode]);

  const filtered = listings.filter((p: any) => String(p.id) !== id);
  const strategyListings = filtered.filter(STRATEGIES.find(s => s.slug === active)?.heuristics ?? (() => true));

  if (!zipCode) return (
    <p className="text-sm text-haze">Enter a ZIP code to browse nearby properties by strategy.</p>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {STRATEGIES.map((s) => (
          <button
            key={s.slug}
            onClick={() => setActive(s.slug)}
            className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors ${
              active === s.slug ? 'border-pass bg-pass/10 text-pass' : 'border-line text-haze hover:text-foreground'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-haze">Loading nearby listings\u2026</p>
      ) : strategyListings.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {strategyListings.slice(0, 6).map((p: any) => {
            const r = Number(p.estimated_rent) || 0;
            const pr = Number(p.price) || 0;
            const ratio = pr > 0 && r > 0 ? ((r / pr) * 100).toFixed(2) : null;
            return (
              <Link
                key={p.id}
                href={`/property/${p.id}`}
                className="rounded-[var(--r-panel)] p-4 transition-colors hover:bg-ink-2"
                style={{ background: 'var(--ink-panel)', border: '1px solid var(--line)' }}
              >
                <p className="text-sm font-medium text-foreground truncate">{p.address}</p>
                <div className="flex items-baseline justify-between mt-1">
                  <span className="figure">{pr > 0 ? usd0.format(pr) : '\u2014'}</span>
                  {ratio && (
                    <span className={`figure text-sm ${Number(ratio) >= 1 ? 'figure--pass' : ''}`}
                      style={Number(ratio) < 1 ? { color: 'var(--brass-hi)' } : undefined}>
                      {ratio}%
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-haze">No nearby properties match this strategy in {zipCode}.</p>
      )}
    </div>
  );
}
