'use client';

import { useEffect, useRef, useState } from 'react';

interface HistogramBin {
  loPct: number;
  hiPct: number;
  count: number;
}

interface StatsShape {
  total: number;
  onePercentPasses: number;
  medianRatioPct: number | null;
  histogram: HistogramBin[];
  thresholdPct: number;
}

const fmt = new Intl.NumberFormat('en-US');

/**
 * Market pulse — the rent/price distribution drawn as a histogram with the 1%
 * line drawn literally through it. The brand's one memorable image: almost
 * everything sits in brass below the line; the few deals that clear it glow.
 * Wired to the real /api/stats histogram (gated to standard, rentable, rent-done
 * listings) — not seeded data.
 */
export function MarketPulse() {
  const [stats, setStats] = useState<StatsShape | null>(null);
  const [seen, setSeen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/stats', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j: StatsShape) => {
        if (!cancelled) setStats(j);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Don't render the section until there's a non-empty distribution to show.
  const bins = stats?.histogram ?? [];
  const peak = Math.max(1, ...bins.map((b) => b.count));
  const hasData = bins.some((b) => b.count > 0);
  if (stats && !hasData) return null;

  const threshold = stats?.thresholdPct ?? 1.0;
  const clears = stats?.onePercentPasses ?? 0;
  const median = stats?.medianRatioPct ?? null;

  return (
    <section
      aria-labelledby="pulse-headline"
      className="border-t border-slate-200/70 bg-slate-50"
    >
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-6 py-16 lg:grid-cols-12 lg:items-end lg:px-8">
        <div className="lg:col-span-4">
          <p className="font-mono text-[11px] uppercase tracking-widest text-amber-700">
            Market pulse
          </p>
          <h2
            id="pulse-headline"
            className="mt-2 text-2xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-3xl"
          >
            Almost nothing clears.
            <br />
            That&rsquo;s the edge.
          </h2>
          <p className="mt-4 max-w-sm text-sm leading-7 text-slate-600">
            {median != null ? (
              <>Most listings sit near {median.toFixed(2)}% rent-to-price. </>
            ) : null}
            The{' '}
            <span className="font-semibold tabular-nums text-emerald-700">
              {fmt.format(clears)}
            </span>{' '}
            that cross the {threshold.toFixed(2)}% line are the only ones worth
            your time — and we surface them first.
          </p>
          <div className="mt-6 flex gap-5 text-sm">
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-sm bg-emerald-600" />
              <span className="text-slate-600">Clears the rule</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-sm bg-amber-600/70" />
              <span className="text-slate-600">Below the rule</span>
            </span>
          </div>
        </div>

        <div className="lg:col-span-8" ref={ref}>
          <div className="flex h-56 items-end gap-1">
            {bins.map((b, i) => {
              const above = b.loPct >= threshold;
              const h = (b.count / peak) * 100;
              return (
                <div
                  key={i}
                  className="group relative flex h-full flex-1 flex-col justify-end"
                  title={`${b.loPct.toFixed(1)}–${b.hiPct.toFixed(1)}% · ${fmt.format(b.count)}`}
                >
                  <div
                    className={`rounded-t-sm transition-[height] duration-700 ease-out ${
                      above ? 'bg-emerald-600' : 'bg-amber-600/60'
                    }`}
                    style={{ height: seen ? `${h}%` : '0%', transitionDelay: `${i * 18}ms` }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-2 h-px bg-slate-200" />
          <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-slate-500">
            <span>{bins[0]?.loPct.toFixed(1) ?? '0.2'}%</span>
            <span className="text-emerald-700">↑ {threshold.toFixed(2)}% line</span>
            <span>{bins[bins.length - 1]?.hiPct.toFixed(1) ?? '1.7'}%</span>
          </div>
        </div>
      </div>
    </section>
  );
}
