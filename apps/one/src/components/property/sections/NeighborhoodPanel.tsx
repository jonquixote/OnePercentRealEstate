'use client';

import { useEffect, useState } from 'react';

interface School {
  name: string;
  level?: string;
  distance?: string;
  distance_miles?: number;
}

interface NeighborhoodData {
  walkability?: { score?: number | null; description?: string | null } | null;
  walk_score?: { score?: number | null; description?: string | null } | null;
  transit?: { stop_count?: number | null; nearest_rail?: string | null; rail_distance_mi?: number | null } | null;
  schools?: School[] | null;
  nearby_schools?: unknown;
  crime?: { summary?: string | null; coverage?: string | null; incidents?: Record<string, number> | null } | null;
}

function walkDialColor(score: number): string {
  if (score >= 90) return 'var(--pass-hi)';
  if (score >= 70) return 'var(--pass)';
  if (score >= 50) return 'var(--brass-hi)';
  if (score >= 25) return 'var(--brass)';
  return 'var(--loss)';
}

function walkDialLabel(score: number): string {
  if (score >= 90) return "Walker's Paradise";
  if (score >= 70) return 'Very Walkable';
  if (score >= 50) return 'Somewhat Walkable';
  if (score >= 25) return 'Car-Dependent';
  return 'Almost All Errands Require a Car';
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

export function NeighborhoodPanel({ propertyId }: { propertyId: string | number }) {
  const [data, setData] = useState<NeighborhoodData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(`/api/properties/${propertyId}/context`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        setData(d?.neighborhood ?? null);
      })
      .catch(() => { if (alive) setData(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [propertyId]);

  if (loading) return <Skeleton />;
  if (!data) return null;

  const walkScore = data.walkability?.score ?? data.walk_score?.score ?? null;
  const walkDesc = data.walkability?.description ?? data.walk_score?.description ?? null;
  const hasSchools = data.schools && data.schools.length > 0;
  const hasNearbySchools = data.nearby_schools != null;
  const hasCrime = data.crime?.summary || data.crime?.coverage;
  const hasTransit = data.transit?.stop_count != null || data.transit?.nearest_rail;
  const hasAny = walkScore != null || hasSchools || hasCrime || hasTransit || hasNearbySchools;
  if (!hasAny) return null;

  return (
    <div className="space-y-4 rounded-2xl border border-line bg-card p-6">
      {/* EPA walkability dial */}
      {walkScore != null && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-foreground">Walkability</span>
            <span className="figure text-lg" style={{ color: walkDialColor(walkScore) }}>{walkScore}</span>
          </div>
          <div className="band mb-1">
            <div className="band-fill" style={{ width: `${(walkScore / 20) * 100}%`, background: walkDialColor(walkScore) }} />
          </div>
          <p className="text-xs text-haze">{walkDialLabel(walkScore)}</p>
        </div>
      )}

      {/* Walk Score® attribution */}
      {walkScore != null && (
        <p className="text-xs text-muted-foreground" style={{ color: 'var(--mute)' }}>
          Walk Score® measures the walkability of any address.
          {walkDesc ? ` ${walkDesc}` : ''}
          {' '}
          <a
            href="https://www.walkscore.com/how-it-works/"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--info)' }}
          >
            Learn how Walk Score works
          </a>
          {' '}&middot;{' '}
          <a
            href="https://walkscore.link"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--info)' }}
          >
            walkscore.link
          </a>
        </p>
      )}

      {/* Transit summary */}
      {hasTransit && data.transit && (
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-foreground">Transit</span>
          <span className="text-xs text-haze">
            {data.transit.stop_count != null && `${data.transit.stop_count} stops`}
            {data.transit.stop_count != null && data.transit.nearest_rail && ' · '}
            {data.transit.nearest_rail && (
              <>
                {data.transit.nearest_rail}
                {data.transit.rail_distance_mi != null && ` (${data.transit.rail_distance_mi.toFixed(1)} mi)`}
              </>
            )}
          </span>
        </div>
      )}

      {/* Schools */}
      {hasSchools && (
        <div className="space-y-1.5">
          <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Schools</p>
          <ul className="space-y-1">
            {data.schools!.map((s, i) => (
              <li key={i} className="flex items-baseline justify-between text-xs text-haze">
                <span className="truncate">
                  {s.name}
                  {s.level && <span className="ml-1 text-muted-foreground">{s.level}</span>}
                </span>
                <span className="ml-2 shrink-0 text-muted-foreground">
                  {s.distance || (s.distance_miles != null ? `${s.distance_miles.toFixed(1)} mi` : '')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Crime row */}
      {hasCrime && data.crime && (
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-foreground">Crime</span>
          <span className="text-xs text-haze">{data.crime.summary || '—'}</span>
        </div>
      )}
      {data.crime?.coverage && (
        <p className="text-xs text-muted-foreground" style={{ color: 'var(--mute)' }}>{data.crime.coverage}</p>
      )}

      {/* HomeHarvest nearby_schools (raw JSONB) */}
      {hasNearbySchools && (
        <details className="group">
          <summary className="cursor-pointer text-xs font-mono uppercase tracking-wider text-muted-foreground">
            Nearby Schools (raw)
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-ink-2 p-3 text-xs text-haze" style={{ font: '12px/1.5 var(--font-num)' }}>
            {typeof data.nearby_schools === 'string'
              ? data.nearby_schools
              : JSON.stringify(data.nearby_schools, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
