'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

type OwnerReturn = { years: { year: number; equity: number; cumCashFlow: number; propertyValue: number }[]; equityMultiple: number; avgAnnualCashOnCash: number };
type Resp = { ownerReturn?: OwnerReturn; inputs?: { provenance: string[] } };
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function OwnerReturnBreakdown({ listingId }: { listingId: string }) {
  const [d, setD] = useState<Resp | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/valuation/${listingId}`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (live) setD(j); }).catch(() => {});
    return () => { live = false; };
  }, [listingId]);
  if (!d) return null;

  if (!d.ownerReturn) {
    return (
      <div className="mat p-5">
        <p className="prov">Ten-year owner return</p>
        <p className="mt-2 text-[14px]" style={{ color: 'var(--haze)' }}>
          Equity multiple, per-year cash flow, and appreciation modeling are a Pro feature.
        </p>
        <Link href="/pricing" className="mt-3 inline-block rounded-[6px] px-4 py-2 text-[13px] font-semibold" style={{ background: 'var(--brass)', color: 'var(--ink)' }}>
          Unlock with Pro
        </Link>
      </div>
    );
  }

  const or = d.ownerReturn;
  return (
    <div className="mat p-5">
      <p className="prov">Ten-year owner return · {(or.avgAnnualCashOnCash * 100).toFixed(1)}% avg cash-on-cash</p>
      <p className="figure mt-1 text-3xl figure--pass">{or.equityMultiple.toFixed(1)}×</p>
      <p className="prov">equity multiple on cash invested</p>
      <table className="mt-3 w-full text-[12px]" style={{ color: 'var(--text)' }}>
        <thead><tr style={{ color: 'var(--mute)' }}><th className="text-left">Yr</th><th className="text-right">Value</th><th className="text-right">Equity</th><th className="text-right">Cum. cash</th></tr></thead>
        <tbody>
          {or.years.filter((y) => y.year % 2 === 1 || y.year === 10).map((y) => (
            <tr key={y.year}>
              <td>{y.year}</td>
              <td className="text-right tabular-nums">{usd0.format(y.propertyValue)}</td>
              <td className="text-right tabular-nums">{usd0.format(y.equity)}</td>
              <td className="text-right tabular-nums">{usd0.format(y.cumCashFlow)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {d.inputs?.provenance?.length ? <p className="prov mt-3">Assumptions: {d.inputs.provenance.join(' · ')}</p> : null}
    </div>
  );
}
