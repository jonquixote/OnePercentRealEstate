'use client';

import { useState, useEffect } from 'react';

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

interface Props {
  property: any;
  hudData: any;
  price: number;
  rent: number;
  beds: number | null;
  sqft: number | null;
  hasRent: boolean;
  ratioPct: number | null;
  targetPct: number;
  taxAnnual: number | null;
  insurance: number | null;
  hoa: number | null;
  monthlyCashflow: number | null;
  capRate: number | null;
  cashOnCash: number | null;
}

export default function VerdictRailClient({
  property, price, rent, hasRent, ratioPct, targetPct,
  taxAnnual, insurance, hoa,
  monthlyCashflow, capRate, cashOnCash,
}: Props) {
  const [watched, setWatched] = useState(false);
  const [savingWatch, setSavingWatch] = useState(false);
  const [mortgageRate, setMortgageRate] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/mortgage-rates')
      .then(r => r.json())
      .then(d => setMortgageRate(d.rate ?? null))
      .catch(() => {});
    fetch('/api/watchlists')
      .then(r => r.ok ? r.json() : [])
      .then((list) => {
        if (Array.isArray(list) && list.some((w: any) => w.name === `Property: ${property.address}`)) setWatched(true);
      })
      .catch(() => {});
  }, [property.address]);

  const toggleWatch = async () => {
    setSavingWatch(true);
    try {
      if (watched) {
        const list = await fetch('/api/watchlists').then(r => r.ok ? r.json() : []);
        const existing = Array.isArray(list) ? list.find((w: any) => w.name === `Property: ${property.address}`) : null;
        if (existing?.id) await fetch(`/api/watchlists?id=${existing.id}`, { method: 'DELETE' });
        setWatched(false);
      } else {
        const resp = await fetch('/api/watchlists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `Property: ${property.address}`,
            query_json: {
              zip_code: property.raw_data?.zip_code,
              price: { max: price * 1.05 },
              bedrooms: property.financial_snapshot?.bedrooms ? { min: property.financial_snapshot.bedrooms - 1, max: property.financial_snapshot.bedrooms + 1 } : undefined,
            },
          }),
        });
        if (resp.ok) setWatched(true);
      }
    } catch { /* silent */ }
    setSavingWatch(false);
  };

  return (
    <div className="rounded-[var(--r-panel)] p-6" style={{ background: 'var(--ink-panel)', border: '1px solid var(--line)' }}>
      <p className="prov mb-4 inline-block">the verdict</p>

      <div className="flex items-baseline gap-3">
        <span className={`figure text-[40px] ${ratioPct && ratioPct >= targetPct ? 'figure--pass' : ''}`}
          style={ratioPct != null && ratioPct < targetPct ? { color: 'var(--haze)' } : undefined}>
          {ratioPct != null ? `${ratioPct.toFixed(2)}%` : '\u2014'}
        </span>
        <span className="text-[13px]" style={{ color: 'var(--haze)' }}>
          vs {targetPct.toFixed(1)}% target
        </span>
      </div>
      <div className="rule-line my-4" />

      <dl className="space-y-3 text-[14px]">
        {[
          ['Modeled rent', hasRent ? `${usd0.format(rent)}/mo` : '\u2014', 'model v1', hasRent],
          ['Property tax', taxAnnual ? `${usd0.format(taxAnnual)}/yr` : '\u2014', 'listing', !!taxAnnual],
          ['Insurance', insurance ? `${usd0.format(insurance)}/yr` : '\u2014', 'state avg', !!insurance],
          ['HOA', hoa != null ? (hoa > 0 ? `${usd0.format(hoa)}/mo` : 'None') : '\u2014', 'listing', hoa != null],
        ].map(([k, v, src, ok]) => (
          <div key={k as string} className="flex items-baseline justify-between gap-2">
            <dt style={{ color: 'var(--haze)' }}>{k}</dt>
            <dd className="flex items-center gap-2">
              <span className="figure">{v as string}</span>
              <span className={`prov ${ok ? 'prov--real' : 'prov--est'}`}>{src as string}</span>
            </dd>
          </div>
        ))}
      </dl>

      <div className="my-5" style={{ borderTop: '1px solid var(--line)' }} />

      <dl className="space-y-3 text-[14px]">
        <div className="flex justify-between">
          <dt style={{ color: 'var(--haze)' }}>Cap rate</dt>
          <dd className="figure">{capRate != null ? `${(capRate * 100).toFixed(1)}%` : '\u2014'}</dd>
        </div>
        <div className="flex justify-between">
          <dt style={{ color: 'var(--haze)' }}>Cash flow</dt>
          <dd className={`figure ${monthlyCashflow != null && monthlyCashflow >= 0 ? 'figure--pass' : monthlyCashflow != null ? 'figure--loss' : ''}`}>
            {monthlyCashflow != null ? `${monthlyCashflow >= 0 ? '+' : ''}${usd0.format(Math.abs(Math.round(monthlyCashflow)))}/mo` : '\u2014'}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt style={{ color: 'var(--haze)' }}>Cash-on-cash</dt>
          <dd className="figure">{cashOnCash != null ? `${(cashOnCash * 100).toFixed(1)}%` : '\u2014'}</dd>
        </div>
      </dl>

      <button
        onClick={toggleWatch}
        disabled={savingWatch}
        className="mt-6 w-full rounded-full py-2.5 text-[14px] font-semibold transition-colors disabled:opacity-50"
        style={{ background: watched ? 'var(--line-hi)' : 'var(--pass)', color: watched ? 'var(--text)' : '#fff' }}
      >
        {savingWatch ? 'Saving\u2026' : watched ? 'Watching' : 'Watch this property'}
      </button>
      <p className="mt-3 text-center text-[11px]" style={{ color: 'var(--mute)' }}>
        financing: 20% down \u00b7 {mortgageRate != null ? `${mortgageRate.toFixed(2)}%` : '\u2014'} (FRED, live) \u00b7 30yr
      </p>
    </div>
  );
}
