'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Loader2 } from 'lucide-react';

interface Stats {
  total: number;
  onePercentPasses: number;
  medianRatioPct: number | null;
  markets: number;
  rentable: number;
  rentCalcPending: number;
  lastUpdated: string;
}

/** Callback so the parent page can consume stats without a duplicate fetch. */
interface StatsStripProps {
  onStatsLoaded?: (stats: Stats) => void;
}

function formatCount(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

function formatPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(2)}%`;
}

/**
 * Numeric trust strip. Shown directly under the hero. Uses mono numerals
 * so the eye reads precision rather than marketing copy.
 *
 * Auto-polls every 120s so stats stay fresh without a page reload.
 */
export function StatsStrip({ onStatsLoaded }: StatsStripProps) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const retryCount = useRef(0);
  const onStatsLoadedRef = useRef(onStatsLoaded);
  onStatsLoadedRef.current = onStatsLoaded;

  const fetchStats = useCallback(async () => {
    try {
      const r = await fetch('/api/stats', { cache: 'no-store' });
      if (!r.ok) throw new Error(`${r.status}`);
      const j: Stats = await r.json();
      setStats(j);
      setErrored(false);
      setLoading(false);
      retryCount.current = 0;
      onStatsLoadedRef.current?.(j);
    } catch {
      retryCount.current += 1;
      if (retryCount.current >= 3) {
        setErrored(true);
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 120_000); // Poll every 2 minutes
    return () => clearInterval(interval);
  }, [fetchStats]);

  const statItems = [
    {
      label: 'Active listings',
      value: stats ? formatCount(stats.total) : '—',
    },
    {
      label: 'Passing 1% rule',
      value: stats ? formatCount(stats.onePercentPasses) : '—',
      accent: 'text-emerald-700',
    },
    {
      label: 'Median rent / price',
      value: stats ? formatPct(stats.medianRatioPct) : '—',
    },
    {
      label: 'Markets covered',
      value: stats ? formatCount(stats.markets) : '—',
    },
  ];

  return (
    <section
      aria-label="Platform statistics"
      className="border-b border-slate-200/70 bg-slate-50/70"
    >
      <div className="mx-auto max-w-7xl px-6 py-6 lg:px-8">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
          {statItems.map((s) => (
            <div key={s.label} className="flex flex-col">
              <dt className="font-mono text-[11px] uppercase tracking-widest text-slate-500">
                {s.label}
              </dt>
              <dd
                className={`mt-1 font-mono text-2xl font-semibold tracking-tight tabular-nums slashed-zero text-slate-900 sm:text-3xl ${s.accent ?? ''}`}
              >
                {loading && !stats ? (
                  <span className="inline-flex items-center gap-2 text-slate-400">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </span>
                ) : errored ? (
                  '—'
                ) : (
                  s.value
                )}
              </dd>
            </div>
          ))}
        </dl>

        {/* Backfill progress indicator */}
        {stats && stats.rentCalcPending > 0 && (
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200/60 px-3 py-2 text-xs text-amber-800">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600" />
            <span>
              <span className="font-semibold tabular-nums">{formatCount(stats.rentCalcPending)}</span>{' '}
              listings are still being analyzed — stats will update automatically.
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
