'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface MarketRow {
  zip: string;
  city: string | null;
  state: string | null;
  medianPrice: number | null;
  medianRent: number | null;
  ratio: number | null;
  hpi5y: number | null;
}

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

// J1 step 4 — where the line clears. Live top-metro grid, every number real.
export function MarketsGrid() {
  const [markets, setMarkets] = useState<MarketRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/markets')
      .then((r) => r.json())
      .then((d) => { if (alive) setMarkets(d.markets ?? []); })
      .catch(() => { if (alive) setMarkets([]); });
    return () => { alive = false; };
  }, []);

  return (
    <section className="mx-auto max-w-7xl px-6 py-16 lg:px-8" style={{ borderTop: '1px solid var(--line)' }}>
      <div className="mb-8 flex items-baseline justify-between">
        <p className="prov" style={{ color: 'var(--mute)' }}>where the line clears</p>
        <Link href="/market" className="text-[13px] font-medium hover:underline" style={{ color: 'var(--haze)' }}>
          All markets →
        </Link>
      </div>

      {markets === null ? (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--r-panel)] sm:grid-cols-3" style={{ background: 'var(--line)', border: '1px solid var(--line)' }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-[3/2] animate-pulse" style={{ background: 'var(--ink-panel)' }} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--r-panel)] sm:grid-cols-3" style={{ background: 'var(--line)', border: '1px solid var(--line)' }}>
          {markets.map((m) => {
            const clears = (m.ratio ?? 0) >= 1;
            const name = m.city ? `${m.city}${m.state ? `, ${m.state}` : ''}` : m.zip;
            return (
              <Link key={m.zip} href={`/market/${m.zip}`} className="group p-5 transition-colors" style={{ background: 'var(--ink)' }}>
                <p className="text-[14px] font-medium">
                  {name} <span style={{ color: 'var(--mute)' }}>{m.zip}</span>
                </p>
                <p className="figure mt-2 text-[22px]" style={{ color: clears ? 'var(--pass)' : 'var(--haze)' }}>
                  {m.ratio != null ? `${m.ratio.toFixed(2)}%` : '—'}
                </p>
                <p className="prov mt-1" style={{ color: 'var(--mute)' }}>
                  {m.medianRent != null ? `rent ${usd0.format(m.medianRent)}/mo` : 'rent —'}
                  {m.hpi5y != null ? ` · HPI +${m.hpi5y}%/5y` : ''}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
