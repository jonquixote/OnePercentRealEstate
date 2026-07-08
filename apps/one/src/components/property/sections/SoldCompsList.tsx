'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en-US');

export function SoldCompsList({ id, property, sqft }: { id: string; property: any; sqft: number | null }) {
  const [comps, setComps] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/properties/${id}/comps`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.comps) setComps(d.comps);
        if (d?.summary) setSummary(d.summary);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return null;

  if (comps.length > 0) {
    return (
      <div className="space-y-3">
        {summary?.median_sold_price != null && (
          <div className="mb-4 rounded-[var(--r-panel)] p-4" style={{ background: 'var(--ink-panel)', border: '1px solid var(--line)' }}>
            <div className="flex items-baseline justify-between">
              <span style={{ color: 'var(--haze)' }}>Median sold price (90d)</span>
              <span className="figure">{usd0.format(summary.median_sold_price)}</span>
            </div>
            {summary.avg_price_per_sqft != null && (
              <p className="mt-1 text-[12px]" style={{ color: 'var(--mute)' }}>
                ${summary.avg_price_per_sqft}/sqft avg \u00b7 {comps.length} comps
              </p>
            )}
          </div>
        )}
        <div className="max-h-[400px] space-y-2 overflow-y-auto">
          {comps.slice(0, 10).map((c: any) => (
            <Link
              key={c.id}
              href={`/sold/${c.id}`}
              className="flex items-baseline justify-between rounded-[var(--r-panel)] p-3 text-[14px] transition-colors hover:bg-ink-2"
              style={{ background: 'var(--ink-2)', border: '1px solid var(--line)', display: 'flex' }}
            >
              <div>
                <span className="figure">{usd0.format(c.sold_price)}</span>
                {c.sqft && <span className="text-[12px]" style={{ color: 'var(--mute)' }}> \u00b7 ${Math.round(c.sold_price / c.sqft)}/sqft</span>}
              </div>
              <div className="text-right">
                <span className="text-[12px]" style={{ color: 'var(--haze)' }}>
                  {c.bedrooms ? `${c.bedrooms}bd` : ''}{c.bathrooms ? `/${c.bathrooms}ba` : ''}{c.sqft ? ` \u00b7 ${num.format(c.sqft)}sqft` : ''}
                </span>
                <br />
                <span className="text-[11px]" style={{ color: 'var(--mute)' }}>
                  {c.sold_date ? String(c.sold_date).slice(0, 10) : ''}{c.distance_meters ? ` \u00b7 ${Math.round(c.distance_meters / 1609)}mi` : ''}
                </span>
              </div>
            </Link>
          ))}
        </div>

        {/* ARV */}
        {(summary?.p75_price_per_sqft != null && sqft != null ? (
          <div className="flex items-center gap-3 pt-4" style={{ borderTop: '1px solid var(--line)' }}>
            <span className="text-[14px]" style={{ color: 'var(--haze)' }}>After-repair value</span>
            <span className="figure text-[18px]">{usd0.format(Math.round(summary.p75_price_per_sqft * sqft))}</span>
            <span className="prov prov--real">ARV from sold comps \u00b7 P75 ${Math.round(summary.p75_price_per_sqft)}/sqft</span>
          </div>
        ) : property.estimated_value != null ? (
          <div className="flex items-center gap-3 pt-4" style={{ borderTop: '1px solid var(--line)' }}>
            <span className="text-[14px]" style={{ color: 'var(--haze)' }}>After-repair value</span>
            <span className="figure text-[18px]">{usd0.format(Number(property.estimated_value))}</span>
            <span className="prov prov--est">ARV from source estimate</span>
          </div>
        ) : null)}
      </div>
    );
  }

  if (property.last_sold_price != null && property.last_sold_date) {
    return (
      <div className="rounded-[var(--r-panel)] p-4" style={{ background: 'var(--ink-panel)', border: '1px solid var(--line)' }}>
        <div className="flex items-baseline justify-between">
          <span style={{ color: 'var(--haze)' }}>Last recorded sale</span>
          <span className="figure">{usd0.format(Number(property.last_sold_price))}</span>
        </div>
        <p className="mt-1 text-[12px]" style={{ color: 'var(--mute)' }}>
          {String(property.last_sold_date).slice(0, 10)}
          {sqft ? ` \u00b7 ${usd0.format(Number(property.last_sold_price) / sqft)}/sqft` : ''}
        </p>
      </div>
    );
  }

  return (
    <p className="text-[14px]" style={{ color: 'var(--mute)' }}>
      Sold comps are being computed \u2014 check back soon.
    </p>
  );
}
