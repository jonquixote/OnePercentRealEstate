'use client';

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
  stats: Stats | null;
  priceCuts?: number;
  mortgageRate?: number | null;
}

const num = new Intl.NumberFormat('en-US');

export function HomeHero({ stats, priceCuts, mortgageRate }: HomeHeroProps) {

  return (
    <section aria-labelledby="hero-headline" className="relative isolate overflow-hidden bg-ink">
        <div className="mx-auto max-w-6xl px-6 pt-24 pb-16 lg:px-8">
        {/* provenance chip */}
        <p className="prov mb-6 inline-block">
          {stats ? num.format(stats.total) : '—'} listings · rescored nightly
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

        <p className="mt-6 max-w-xl text-[15px] leading-relaxed" style={{ color: 'var(--haze)' }}>
          The 1% rule, computed honestly: modeled rent with confidence bands,
          county tax records where they exist, and a per-property target that
          knows a duplex from a condo.
        </p>

        {/* THE glowing Rule Line */}
        <div className="rule-line mt-14" />

        {/* engraved ticker strip — no boxes */}
        <div className="mt-5 flex flex-wrap gap-x-10 gap-y-2 text-[13px]" style={{ color: 'var(--haze)' }}>
          <span>
            <b className="figure" style={{ color: 'var(--text)' }}>
              {stats ? num.format(stats.onePercentPasses) : '—'}
            </b>{' '}
            clear the line today
          </span>
          <span>
            <b className="figure" style={{ color: 'var(--brass-hi)' }}>
              {priceCuts != null ? num.format(priceCuts) : '—'}
            </b>{' '}
            price cuts live
          </span>
          <span>
            <b className="figure" style={{ color: 'var(--text)' }}>
              $484
            </b>{' '}
            model error (MAE, holdout)
          </span>
          <span>
            <b className="figure" style={{ color: 'var(--text)' }}>
              {mortgageRate != null ? `${mortgageRate.toFixed(2)}%` : '—'}
            </b>{' '}
            30-yr rate · FRED
          </span>
        </div>

      </div>
    </section>
  );
}
