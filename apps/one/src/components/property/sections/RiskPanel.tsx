'use client';

import { useEffect, useState } from 'react';

interface RiskData {
  nri_overall_rating?: string | null;
  nri_overall_score?: number | null;
  flood_zone?: string | null;
  flood_sfha?: boolean | null;
  disasters?: Record<string, number> | null;
  parcel_pct_in_sfha?: number | null;
}

function riskColor(rating: string | null | undefined): string {
  if (!rating) return 'var(--haze)';
  const r = rating.toLowerCase();
  if (r.includes('very high') || r.includes('extreme')) return 'var(--loss)';
  if (r.includes('high')) return 'var(--loss)';
  if (r.includes('rel') || r.includes('moderate') || r.includes('medium')) return 'var(--brass-hi)';
  if (r.includes('low') || r.includes('minimal')) return 'var(--pass-hi)';
  return 'var(--haze)';
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-4 rounded-2xl border border-line bg-card p-6">
      <div className="h-4 w-1/3 rounded bg-ink-2" />
      <div className="h-3 w-2/3 rounded bg-ink-2" />
      <div className="h-3 w-1/2 rounded bg-ink-2" />
      <div className="h-3 w-3/4 rounded bg-ink-2" />
    </div>
  );
}

export function RiskPanel({ propertyId }: { propertyId: string | number }) {
  const [data, setData] = useState<RiskData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(`/api/properties/${propertyId}/context`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        setData(d?.risk ?? null);
      })
      .catch(() => { if (alive) setData(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [propertyId]);

  if (loading) return <Skeleton />;
  if (!data) return null;

  const hasAny = data.nri_overall_rating || data.flood_zone || data.flood_sfha || (data.disasters && Object.keys(data.disasters).length > 0) || data.parcel_pct_in_sfha != null;
  if (!hasAny) return null;

  return (
    <div className="space-y-4 rounded-2xl border border-line bg-card p-6">
      {/* NRI overall rating */}
      {data.nri_overall_rating && (
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-foreground">Risk Rating</span>
          <span
            className="rounded-full border px-3 py-1 text-xs font-semibold"
            style={{ color: riskColor(data.nri_overall_rating), borderColor: riskColor(data.nri_overall_rating), background: `color-mix(in srgb, ${riskColor(data.nri_overall_rating)} 8%, transparent)` }}
          >
            {data.nri_overall_rating}
          </span>
        </div>
      )}

      {/* Flood zone badge */}
      {data.flood_zone && (
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-foreground">Flood Zone</span>
          <span
            className="rounded-full border px-3 py-1 text-xs font-semibold"
            style={data.flood_sfha
              ? { color: 'var(--loss)', borderColor: 'var(--loss)', background: 'rgba(194,59,52,.12)' }
              : { color: 'var(--haze)', borderColor: 'var(--line)' }
            }
          >
            {data.flood_zone}
          </span>
        </div>
      )}

      {/* Disasters by type */}
      {data.disasters && Object.keys(data.disasters).length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Disaster Incidents</p>
          <div className="space-y-1.5">
            {Object.entries(data.disasters)
              .sort((a, b) => b[1] - a[1])
              .map(([type, count]) => {
                const maxCount = Math.max(...Object.values(data.disasters!));
                const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
                return (
                  <div key={type} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 truncate text-xs text-haze">{type}</span>
                    <div className="flex-1">
                      <div className="band">
                        <div className="band-fill" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <span className="w-8 text-right text-xs font-mono text-muted-foreground">{count}</span>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Parcel flood exposure */}
      {data.parcel_pct_in_sfha != null && data.parcel_pct_in_sfha > 0 && (
        <p className="text-xs text-haze" style={{ color: 'var(--brass-hi)' }}>
          {data.parcel_pct_in_sfha}% of this parcel is in a flood zone
        </p>
      )}
    </div>
  );
}
