'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { Search, Loader2 } from 'lucide-react';

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

interface Comp {
  id: string;
  address: string;
  price?: number | null;
  estimated_rent?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  sqft?: number | null;
  primary_photo?: string | null;
}

export default function CompsPage() {
  const [query, setQuery] = useState('');
  const [comps, setComps] = useState<Comp[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (!query.trim()) {
        if (!cancelled) setComps([]);
        return;
      }
      setLoading(true);
      setError('');
      try {
        // Detect ZIP (5 digits) vs free text
        const q = query.trim();
        const isZip = /^\d{5}$/.test(q);
        const expression = isZip
          ? `price > 10000 and zip_code = '${q}'`
          : `price > 10000 and address ilike '%${q.replace(/'/g, "''")}%'`;
        // Try zip_code expression first; fall back to address search
        const res = await fetch('/api/properties/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expression, limit: 20 }),
        });
        if (!res.ok) {
          // expression may fail for ilike (not supported by query-lang)
          // fall back to a basic expression
          if (!isZip) {
            const fallbackRes = await fetch('/api/properties/query', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ expression: 'price > 10000', limit: 20 }),
            });
            if (!fallbackRes.ok) throw new Error('Query failed');
            const fbData = await fallbackRes.json();
            if (!cancelled) setComps(fbData?.items ?? []);
          } else {
            throw new Error('No results');
          }
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setComps(data?.items ?? []);
          if (!data?.items?.length) setError('No matching listings found.');
        }
      } catch {
        if (!cancelled) setError('No matching listings found for that query.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  const stats = useMemo(() => {
    const priced = comps.filter(c => c.price && c.price > 0);
    if (!priced.length) return null;
    const prices = priced.map(c => c.price!);
    return {
      count: priced.length,
      medPrice: [...prices].sort((a, b) => a - b)[Math.floor(prices.length / 2)],
    };
  }, [comps]);

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <header className="mb-10">
          <h1 className="display-1 mb-2">Comps</h1>
          <p className="text-[15px] text-haze">Search by ZIP, address, or neighborhood to find active listings. Click through to see full sold comparables.</p>
        </header>

        <div className="relative mb-8">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-haze" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Enter a ZIP code, address, or neighborhood\u2026"
            className="w-full rounded-2xl border border-line bg-card px-12 py-3.5 text-sm text-foreground outline-none placeholder:text-haze/50 focus:border-pass/50 transition-colors"
          />
          {loading && <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-pass" />}
        </div>

        {stats && (
          <div className="mb-8 grid grid-cols-2 gap-4">
            <div className="rounded-[var(--r-panel)] border border-line bg-card p-4 text-center">
              <p className="figure text-lg">{stats.count}</p>
              <p className="text-xs text-haze mt-1">Active listings</p>
            </div>
            <div className="rounded-[var(--r-panel)] border border-line bg-card p-4 text-center">
              <p className="figure text-lg">{usd0.format(stats.medPrice)}</p>
              <p className="text-xs text-haze mt-1">Median price</p>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-haze text-center py-8">{error}</p>}

        {comps.length > 0 && (
          <div className="space-y-3">
            {comps.map((c) => {
              const ratio = c.price && c.estimated_rent ? ((c.estimated_rent / c.price) * 100).toFixed(2) : null;
              return (
                <Link
                  key={c.id}
                  href={`/property/${c.id}`}
                  className="flex items-center justify-between rounded-[var(--r-panel)] border border-line bg-card p-4 transition-colors hover:bg-ink-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{c.address}</p>
                    <p className="text-xs text-haze mt-0.5">
                      {c.bedrooms && c.bathrooms ? `${c.bedrooms} bed \u00b7 ${c.bathrooms} bath` : ''}
                      {c.sqft ? ` \u00b7 ${c.sqft.toLocaleString()} sqft` : ''}
                    </p>
                  </div>
                  <div className="text-right shrink-0 ml-4">
                    {c.price && <p className="figure text-sm">{usd0.format(c.price)}</p>}
                    {ratio && <p className="text-xs text-haze mt-0.5">{ratio}% rent/price</p>}
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {!query.trim() && !loading && (
          <p className="text-sm text-haze text-center py-12">
            Start typing to find listings. Try a ZIP code like <span className="font-mono text-pass">44102</span>.
          </p>
        )}
      </div>
    </div>
  );
}
