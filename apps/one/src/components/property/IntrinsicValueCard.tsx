'use client';
import { useEffect, useState } from 'react';

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

type Resp = { intrinsic: number; marginOfSafety: number; headline: string };

export function IntrinsicValueCard({ listingId }: { listingId: string }) {
  const [d, setD] = useState<Resp | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/valuation/${listingId}`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (live) setD(j); }).catch(() => {});
    return () => { live = false; };
  }, [listingId]);
  if (!d || !(d.intrinsic > 0)) return null;
  const positive = d.marginOfSafety >= 0;
  return (
    <div className="mat p-5">
      <p className="prov">Intrinsic value · income approach</p>
      <p className="figure mt-1 text-3xl" style={{ color: 'var(--text)' }}>{usd0.format(d.intrinsic)}</p>
      <span
        className="mt-3 inline-block rounded-full px-3 py-1 text-[12px] font-semibold"
        style={{ background: positive ? 'var(--pass)' : 'var(--brass)', color: 'var(--ink)' }}
      >
        {d.headline}
      </span>
      <p className="prov mt-3">Value = net operating income ÷ market cap rate. Not investment advice.</p>
    </div>
  );
}
