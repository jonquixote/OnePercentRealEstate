'use client';

import GlobalSearch from '@/components/GlobalSearch';

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

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
  medianRentEstimate?: number | null;
}

interface HomeHeroProps {
  stats: Stats | null;
  priceCuts?: number;
  medianRent?: number | null;
}

const num = new Intl.NumberFormat('en-US');

export function HomeHero({ stats, priceCuts, medianRent }: HomeHeroProps) {

  return (
    <section aria-labelledby="hero-headline" className="relative isolate overflow-hidden bg-ink">
        <div className="mx-auto max-w-6xl px-6 py-8 lg:px-8">
        {/* provenance chip */}
        <p className="prov mb-4 inline-block">
          {stats ? num.format(stats.total) : '\u2014'} listings \u00b7 rescored nightly
        </p>

        {/* editorial serif headline */}
        <h1
          id="hero-headline"
          className="text-balance"
          style={{ font: '300 var(--display-1)/1.04 var(--font-display)' }}
        >
          Every property in America,<br />
          <em style={{ fontStyle: 'italic', color: 'var(--pass-hi)' }}>
            measured against the line.
          </em>
        </h1>

        {/* THE glowing Rule Line */}
        <div className="rule-line mt-8" />

        {/* engraved ticker strip — no boxes */}
        <div className="mt-4 flex flex-wrap gap-x-10 gap-y-2 text-[13px]" style={{ color: 'var(--haze)' }}>
          <span>
            <b className="figure" style={{ color: 'var(--text)' }}>
              {stats ? num.format(stats.onePercentPasses) : '—'}
            </b>{' '}
            clear the 1% line
          </span>
          <span>
            <b className="figure" style={{ color: 'var(--brass-hi)' }}>
              {priceCuts != null ? num.format(priceCuts) : '—'}
            </b>{' '}
            price cuts live
          </span>
          <span>
            <b className="figure" style={{ color: 'var(--text)' }}>
              {medianRent != null ? usd0.format(medianRent) : '—'}
            </b>{' '}
            median rent estimate
          </span>
        </div>

        {/* Hero search */}
        <div className="mt-8">
          <GlobalSearch variant="hero" />
        </div>

      </div>
    </section>
  );
}
