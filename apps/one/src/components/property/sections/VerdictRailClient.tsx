'use client';

import { useState, useEffect } from 'react';
import SaveButton from '@/components/SaveButton';

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export type RentAssessment = {
  verdict: 'trusted' | 'wide' | 'implausible';
  ratio: number;
  reason: string;
};

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
  rentAssessment?: RentAssessment;
}

export default function VerdictRailClient({
  property, price, rent, hasRent, ratioPct, targetPct,
  taxAnnual, insurance, hoa,
  monthlyCashflow, capRate, cashOnCash,
  rentAssessment,
}: Props) {
  const [mortgageRate, setMortgageRate] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/mortgage-rates')
      .then(r => r.json())
      .then(d => setMortgageRate(d.rate ?? null))
      .catch(() => {});
  }, []);

  const verdict = rentAssessment?.verdict;
  const isImplausible = verdict === 'implausible';
  const isWide = verdict === 'wide';

  return (
    <div className="rounded-[var(--r-panel)] p-6" style={{ background: 'var(--ink-panel)', border: '1px solid var(--line)' }}>
      <p className="prov mb-4 inline-block">the verdict</p>

      <div className="flex items-baseline gap-3">
        <span
          className={`figure text-[40px] ${ratioPct && ratioPct >= targetPct && !isImplausible ? 'figure--pass' : ''}`}
          style={isImplausible ? { color: 'var(--brass)' } : ratioPct != null && ratioPct < targetPct ? { color: 'var(--haze)' } : undefined}
        >
          {ratioPct != null ? `${ratioPct.toFixed(2)}%` : '—'}
          {isImplausible && <span aria-label="unverified" style={{ marginLeft: '0.4rem' }}>⚠</span>}
        </span>
        <span className="text-[13px]" style={{ color: 'var(--haze)' }}>
          vs {targetPct.toFixed(1)}% target
        </span>
      </div>

      {isImplausible && (
        <p className="mt-1 text-[12px]" style={{ color: 'var(--brass)' }}>
          Unverified — model rent disagrees with HUD/comps
        </p>
      )}
      {isWide && (
        <p className="mt-1 text-[12px]" style={{ color: 'var(--brass)' }}>
          wide confidence band
        </p>
      )}

      <div className="rule-line my-4" />

      <dl className="space-y-3 text-[14px]">
        {[
          ['Modeled rent', hasRent ? `${usd0.format(rent)}/mo` : '—', 'rent estimate', hasRent],
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
          <dd className="figure">{capRate != null ? `${(capRate * 100).toFixed(1)}%` : '—'}</dd>
        </div>
        <div className="flex justify-between">
          <dt style={{ color: 'var(--haze)' }}>Cash flow</dt>
          <dd className={`figure ${monthlyCashflow != null && monthlyCashflow >= 0 ? 'figure--pass' : monthlyCashflow != null ? 'figure--loss' : ''}`}>
            {monthlyCashflow != null ? `${monthlyCashflow >= 0 ? '+' : ''}${usd0.format(Math.abs(Math.round(monthlyCashflow)))}/mo` : '—'}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt style={{ color: 'var(--haze)' }}>Cash-on-cash</dt>
          <dd className="figure">{cashOnCash != null ? `${(cashOnCash * 100).toFixed(1)}%` : '—'}</dd>
        </div>
      </dl>

      <div className="mt-6 flex justify-center">
        <SaveButton listingId={property.id ?? property.financial_snapshot?.id ?? ''} />
      </div>
      <p className="mt-3 text-center text-[11px]" style={{ color: 'var(--mute)' }}>
        financing: 20% down · {mortgageRate != null ? `${mortgageRate.toFixed(2)}%` : '—'} (FRED, live) · 30yr
      </p>

      {/* M2: mobile sticky CTA bar — replaces the rail on small screens */}
      <div
        className="lg:hidden fixed inset-x-0 bottom-0 z-40 flex items-center gap-3 border-t px-4 py-3 backdrop-blur"
        style={{ background: 'color-mix(in srgb, var(--ink) 92%, transparent)', borderColor: 'var(--line-hi)' }}
      >
        <div className="min-w-0">
          <p className="figure text-[17px] leading-tight">{usd0.format(price)}</p>
          <p
            className="figure text-[12px]"
            style={{
              color: isImplausible
                ? 'var(--brass)'
                : ratioPct != null && ratioPct >= targetPct
                  ? 'var(--pass)'
                  : 'var(--haze)',
            }}
          >
            {ratioPct != null ? `${ratioPct.toFixed(2)}%` : '—'}
            {isImplausible ? ' · unverified' : ` · rent ${hasRent ? usd0.format(rent) : '—'}`}
          </p>
        </div>
        <div className="ml-auto shrink-0">
          <SaveButton listingId={property.id ?? property.financial_snapshot?.id ?? ''} />
        </div>
      </div>
    </div>
  );
}
