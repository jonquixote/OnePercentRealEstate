'use client';

import { useEffect, useState } from 'react';

interface MarketData {
  hpi?: Array<{ date: string; value: number }> | null;
  cagr?: number | null;
  cagr_span_years?: number | null;
  unemployment?: number | null;
}

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function HpiSparkline({ data }: { data: Array<{ date: string; value: number }> }) {
  if (data.length < 2) return null;

  const w = 200, h = 40, pad = 4;
  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const xy = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - 2 * pad);
    const y = h - pad - ((v - min) / span) * (h - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const falling = values[values.length - 1] < values[0];

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Home Price Index trend" className="overflow-visible">
      <polyline
        points={xy.join(' ')}
        fill="none"
        stroke={falling ? 'var(--brass-hi, #c9a35c)' : 'var(--pass, #0e7a52)'}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={xy[xy.length - 1].split(',')[0]} cy={xy[xy.length - 1].split(',')[1]} r="2.5" fill={falling ? 'var(--brass-hi, #c9a35c)' : 'var(--pass, #0e7a52)'} />
    </svg>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-4 rounded-2xl border border-line bg-card p-6">
      <div className="h-4 w-1/3 rounded bg-ink-2" />
      <div className="h-3 w-2/3 rounded bg-ink-2" />
      <div className="h-3 w-1/2 rounded bg-ink-2" />
    </div>
  );
}

export function MarketContextPanel({ propertyId }: { propertyId: string | number }) {
  const [data, setData] = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(`/api/properties/${propertyId}/context`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        setData(d?.market ?? null);
      })
      .catch(() => { if (alive) setData(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [propertyId]);

  if (loading) return <Skeleton />;
  if (!data) return null;

  const hasHpi = data.hpi && data.hpi.length >= 2;
  const cagr = data.cagr ?? null;
  const cagrSpanYears = data.cagr_span_years;
  const hasCagr = cagr != null;
  const unemp = data.unemployment ?? null;
  const hasUnemp = unemp != null;
  const hasAny = hasHpi || hasCagr || hasUnemp;
  if (!hasAny) return null;

  return (
    <div className="space-y-4 rounded-2xl border border-line bg-card p-6">
      {/* HPI sparkline */}
      {hasHpi && (
        <div>
          <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">Home Price Index</p>
          <HpiSparkline data={data.hpi!} />
        </div>
      )}

      {/* CAGR (span labelled dynamically) */}
      {hasCagr && cagr != null && (
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-foreground">{cagrSpanYears ?? 5}-yr CAGR</span>
          <span
            className="figure text-sm"
            style={{ color: cagr >= 0 ? 'var(--pass-hi)' : 'var(--loss)' }}
          >
            {cagr >= 0 ? '+' : ''}{cagr.toFixed(1)}%
          </span>
        </div>
      )}

      {/* Unemployment */}
      {hasUnemp && unemp != null && (
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-foreground">Unemployment</span>
          <span className="figure text-sm">{unemp.toFixed(1)}%</span>
        </div>
      )}
    </div>
  );
}
