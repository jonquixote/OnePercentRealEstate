'use client';

import { useEffect, useState } from 'react';

interface Stats {
  total: number;
  onePercentPasses: number;
  medianRatioPct: number | null;
  markets: number;
  lastUpdated: string;
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
 */
export function StatsStrip() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/stats', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => {
        if (!cancelled) setStats(j);
      })
      .catch(() => {
        if (!cancelled) setErrored(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section
      aria-label="Platform statistics"
      className="border-b border-slate-200/70 bg-slate-50/70"
    >
      <div className="mx-auto max-w-7xl px-6 py-6 lg:px-8">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
          {[
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
          ].map((s) => (
            <div key={s.label} className="flex flex-col">
              <dt className="font-mono text-[11px] uppercase tracking-widest text-slate-500">
                {s.label}
              </dt>
              <dd
                className={`mt-1 font-mono text-2xl font-semibold tracking-tight tabular-nums slashed-zero text-slate-900 sm:text-3xl ${s.accent ?? ''}`}
              >
                {errored ? '—' : s.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
