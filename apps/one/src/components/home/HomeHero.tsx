'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, ArrowRight, ArrowDown } from 'lucide-react';
import { RatioTape } from './RatioTape';
import { STRATEGIES, STRATEGY_BY_ID, type Strategy } from '@/lib/strategies';

interface HistogramBin {
  loPct: number;
  hiPct: number;
  count: number;
}
interface Stats {
  total: number;
  onePercentPasses: number;
  medianRatioPct: number | null;
  markets: number;
  rentCalcPending: number;
  histogram: HistogramBin[];
  thresholdPct: number;
}

interface HomeHeroProps {
  strategy: Strategy;
  onStrategy: (s: Strategy) => void;
  stats: Stats | null;
  onBrowse?: () => void;
}

const num = new Intl.NumberFormat('en-US');
function fmtPct(n: number | null): string {
  return n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(2)}%`;
}

export function HomeHero({ strategy, onStrategy, stats, onBrowse }: HomeHeroProps) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const meta = STRATEGY_BY_ID[strategy];

  const threshold = stats?.thresholdPct ?? 1.0;
  const ticker: Array<[string, string, boolean]> = [
    ['Active listings', stats ? num.format(stats.total) : '—', false],
    ['Clear the line', stats ? num.format(stats.onePercentPasses) : '—', true],
    ['Median rent / price', fmtPct(stats?.medianRatioPct ?? null), false],
    ['Markets covered', stats ? num.format(stats.markets) : '—', false],
  ];

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const term = q.trim();
    router.push(term ? `/search?q=${encodeURIComponent(term)}` : '/search');
  }

  return (
    <section aria-labelledby="hero-headline" className="relative isolate overflow-hidden bg-ink">
      {/* faint grid, masked toward the corner */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.05]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(120% 100% at 25% 0%, black, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(120% 100% at 25% 0%, black, transparent 75%)',
        }}
      />

      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="grid grid-cols-1 items-center gap-12 py-16 lg:grid-cols-2 lg:py-20">
          {/* left */}
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-line bg-white/[0.03] px-3 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-pass-hi shadow-[0_0_8px_var(--pass-hi)]" />
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-haze">
                Live MLS · {stats ? num.format(stats.markets) : '50'} markets · {stats ? num.format(stats.total) : '—'} listings
              </span>
            </div>

            <h1
              id="hero-headline"
              className="mt-6 text-balance font-sans text-[clamp(40px,6vw,66px)] font-semibold leading-[1.02] tracking-[-0.03em] text-white"
            >
              Underwrite less.
              <br />
              Buy what <span className="text-pass-hi">clears</span>.
            </h1>

            {/* strategy lens */}
            <div className="mt-7">
              <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                Your strategy · the line moves with it
              </p>
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="Investing strategy">
                {STRATEGIES.map((s) => {
                  const active = s.id === strategy;
                  return (
                    <button
                      key={s.id}
                      role="tab"
                      aria-selected={active}
                      onClick={() => onStrategy(s.id)}
                      className={`rounded-full border px-3.5 py-1.5 font-mono text-[12px] font-medium transition-colors ${
                        active
                          ? 'border-pass bg-pass/15 text-pass-hi'
                          : 'border-line bg-white/[0.02] text-haze hover:bg-white/[0.05]'
                      }`}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <p className="mt-5 max-w-md text-pretty text-[15.5px] leading-7 text-haze">
              {meta.thesis}
              {meta.provisional && (
                <span className="ml-2 rounded bg-brass/20 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-brass-hi">
                  provisional
                </span>
              )}
            </p>

            {/* command search */}
            <form onSubmit={submitSearch} className="mt-7 flex max-w-md items-center gap-2 rounded-xl bg-white p-1.5 shadow-[0_12px_30px_-16px_rgba(0,0,0,0.6)] focus-within:ring-2 focus-within:ring-pass">
              <Search className="ml-2 h-[18px] w-[18px] text-slate-500" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search a city, ZIP, or address"
                aria-label="Search a city, ZIP, or address"
                className="flex-1 border-0 bg-transparent px-1 py-2 text-[15px] text-slate-900 outline-none placeholder:text-slate-400"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2.5 font-sans text-[14px] font-semibold text-white transition-colors hover:bg-ink-2"
              >
                Score it <ArrowRight className="h-[15px] w-[15px]" />
              </button>
            </form>

            <div className="mt-5 flex flex-wrap gap-5">
              <button onClick={onBrowse} className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-white hover:text-pass-hi">
                Browse the map <ArrowDown className="h-[15px] w-[15px]" />
              </button>
              <a href="#pulse" className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-haze hover:text-white">
                See the market distribution
              </a>
            </div>
          </div>

          {/* right: the tape */}
          <div>
            <RatioTape
              bins={stats?.histogram ?? []}
              thresholdPct={threshold}
              clears={stats?.onePercentPasses ?? 0}
              total={stats?.total ?? 0}
              loading={!stats}
            />
          </div>
        </div>
      </div>

      {/* ticker */}
      <div className="border-t border-line bg-white/[0.015]">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <dl className="grid grid-cols-2 md:grid-cols-4">
            {ticker.map(([label, value, pass], i) => (
              <div key={label} className={`py-5 ${i === 0 ? '' : 'border-l border-line pl-5'}`}>
                <dt className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</dt>
                <dd className={`mt-1.5 font-mono text-[26px] font-semibold tabular-nums ${pass ? 'text-pass-hi' : 'text-white'}`}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
