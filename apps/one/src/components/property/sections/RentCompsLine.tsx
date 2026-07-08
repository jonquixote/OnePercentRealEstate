'use client';

import { useEffect, useState } from 'react';

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function RentCompsLine({ id, zip }: { id: string; zip?: string | null }) {
  const [compsMedian, setCompsMedian] = useState<number | null>(null);

  useEffect(() => {
    if (!zip) return;
    fetch(`/api/estimate-rent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zip_code: zip, listing_id: id }),
    })
      .then(r => r.json())
      .then(d => {
        if (d?.comps_median) setCompsMedian(d.comps_median);
      })
      .catch(() => {});
  }, [id, zip]);

  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[14px]" style={{ color: 'var(--haze)' }}>Area comps median (last 90d)</span>
      <span className="figure text-[18px]">
        {compsMedian != null ? `${usd0.format(compsMedian)}/mo` : '\u2014'}
      </span>
    </div>
  );
}
