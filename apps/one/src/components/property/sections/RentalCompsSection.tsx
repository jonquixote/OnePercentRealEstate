'use client';

import { useEffect, useState } from 'react';

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en-US');

export function RentalCompsSection({ id }: { id: string }) {
  const [comps, setComps] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    fetch(`/api/properties/${id}/rental-comps`)
      .then(r => {
        if (!r.ok) throw new Error(`API returned ${r.status}`);
        return r.json();
      })
      .then(d => {
        if (d?.comps) setComps(d.comps);
        if (d?.summary) setSummary(d.summary);
      })
      .catch((e) => setError(e.message || 'Failed to load rental comps'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return (
    <p className="text-sm text-haze">Loading rental comps\u2026</p>
  );

  if (error) return (
    <p className="text-sm" style={{ color: 'var(--haze)' }}>
      {error}
    </p>
  );

  if (comps.length === 0) return (
    <p className="text-sm" style={{ color: 'var(--haze)' }}>
      No rental comps available for this area.
    </p>
  );

  return (
    <div className="space-y-3 mt-4">
      <p className="prov mb-3">rental comps (6mo)</p>
      {summary?.median_rent != null && (
        <div className="mb-3 rounded-[var(--r-panel)] p-3" style={{ background: 'var(--ink-panel)', border: '1px solid var(--line)' }}>
          <div className="flex items-baseline justify-between">
            <span style={{ color: 'var(--haze)' }}>Median rent (last 6mo)</span>
            <span className="figure">{`${usd0.format(summary.median_rent)}/mo`}</span>
          </div>
          <p className="mt-1 text-[12px]" style={{ color: 'var(--mute)' }}>
            {summary.avg_price_per_sqft != null ? `$${summary.avg_price_per_sqft}/sqft avg \u00b7 ${comps.length} comps` : `${comps.length} comps`}
          </p>
        </div>
      )}
      <div className="max-h-[300px] space-y-1.5 overflow-y-auto">
        {comps.slice(0, 15).map((c: any) => (
          <div key={c.id} className="flex items-baseline justify-between rounded-[var(--r-panel)] p-2.5 text-[13px]"
               style={{ background: 'var(--ink-2)', border: '1px solid var(--line)' }}>
            <div>
              <span className="figure">{`${usd0.format(c.price)}/mo`}</span>
              {c.sqft && <span className="text-[11px]" style={{ color: 'var(--mute)' }}> \u00b7 ${Math.round(c.price / c.sqft)}/sqft</span>}
            </div>
            <div className="text-right">
              <span className="text-[11px]" style={{ color: 'var(--haze)' }}>
                {c.bedrooms ? `${c.bedrooms}bd` : ''}{c.bathrooms ? `/${c.bathrooms}ba` : ''}{c.sqft ? ` \u00b7 ${num.format(c.sqft)}sqft` : ''}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
