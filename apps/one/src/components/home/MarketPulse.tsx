'use client';

import { useEffect, useRef, useState } from 'react';
import { STRATEGY_BY_ID, type Strategy } from '@/lib/strategies';

interface HistogramBin {
  loPct: number;
  hiPct: number;
  count: number;
}

interface MarketPulseProps {
  strategy: Strategy;
  histogram: HistogramBin[];
  thresholdPct: number;
  clears: number;
  medianRatioPct: number | null;
}

const fmt = new Intl.NumberFormat('en-US');

/**
 * Market pulse — the rent/price distribution with the rule line drawn through
 * it. The brand's one memorable image: almost everything sits in brass below
 * the line; the few deals that clear it glow. Reframes per strategy.
 */
export function MarketPulse({ strategy, histogram, thresholdPct, clears, medianRatioPct }: MarketPulseProps) {
  const [seen, setSeen] = useState(false);
  const [reduced, setReduced] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const meta = STRATEGY_BY_ID[strategy];

  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(m.matches);
    on();
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
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

  const bins = histogram ?? [];
  const peak = Math.max(1, ...bins.map((b) => b.count));
  const hasData = bins.some((b) => b.count > 0);
  if (!hasData) return null;

  return (
    <section id="pulse" aria-labelledby="pulse-headline" className="border-t border-line bg-ink-panel/40">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-6 py-16 lg:grid-cols-12 lg:items-end lg:px-8">
        <div className="lg:col-span-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-brass-hi">Market pulse</p>
          <h2
            id="pulse-headline"
            className="mt-2 font-sans text-[clamp(26px,3vw,36px)] font-semibold leading-[1.1] tracking-[-0.02em] text-white"
          >
            Almost nothing clears.
            <br />
            That&rsquo;s the edge.
          </h2>
          <p className="mt-4 max-w-sm text-[15px] leading-7 text-haze">
            {medianRatioPct != null ? <>Most listings sit near {medianRatioPct.toFixed(2)}% rent-to-price. </> : null}
            The <span className="font-semibold tabular-nums text-pass-hi">{fmt.format(clears)}</span> that cross the{' '}
            {thresholdPct.toFixed(2)}% {meta.lineName.includes('rule') ? 'line' : 'line'} are the only ones worth your time — and we surface them first.
          </p>
          <div className="mt-6 flex gap-5 text-[13px]">
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-sm bg-pass" />
              <span className="text-haze">Clears the {meta.lineName}</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-sm bg-brass/70" />
              <span className="text-haze">Below</span>
            </span>
          </div>
        </div>

        <div className="lg:col-span-8" ref={ref}>
          <div
            className="flex h-56 items-end gap-1"
            role="img"
            aria-label={`Distribution of rent-to-price ratios. ${fmt.format(clears)} listings clear the ${thresholdPct.toFixed(2)}% line.`}
          >
            {bins.map((b, i) => {
              const above = b.loPct >= thresholdPct;
              const h = (b.count / peak) * 100;
              const grown = seen || reduced;
              return (
                <div
                  key={i}
                  aria-hidden
                  className="group relative flex h-full flex-1 flex-col justify-end"
                  title={`${b.loPct.toFixed(1)}–${b.hiPct.toFixed(1)}% · ${fmt.format(b.count)}`}
                >
                  <div
                    className={`rounded-t-sm ${reduced ? '' : 'transition-[height] duration-700 ease-out'} ${
                      above ? 'bg-pass' : 'bg-brass/55'
                    }`}
                    style={{ height: grown ? `${h}%` : '0%', transitionDelay: reduced ? '0ms' : `${i * 18}ms` }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-2 h-px bg-line" />
          <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-muted-foreground">
            <span>{bins[0]?.loPct.toFixed(1) ?? '0.2'}%</span>
            <span className="text-pass-hi">↑ {thresholdPct.toFixed(2)}% line</span>
            <span>{bins[bins.length - 1]?.hiPct.toFixed(1) ?? '1.7'}%</span>
          </div>
        </div>
      </div>
    </section>
  );
}
