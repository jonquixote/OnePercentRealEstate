'use client';

import { useState, useMemo } from 'react';
import { evaluateRules, compositeScore, type PropertyInputs, type RuleConfig } from '@oper/primitives';
import Link from 'next/link';

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fpct = (v: number) => `${(v * 100).toFixed(1)}%`;

const STRATEGY_LABELS: Record<string, string> = {
  buy_hold: 'Buy & Hold',
  brrrr: 'BRRRR',
  flip: 'Buy & Flip',
  str: 'Short-Term',
};

export default function CalculatorPage() {
  const [price, setPrice] = useState(200_000);
  const [rent, setRent] = useState(2_000);
  const [sqft, setSqft] = useState(1_500);
  const [hoa, setHoa] = useState(0);
  const [taxRate, setTaxRate] = useState(0.012);
  const [insurance, setInsurance] = useState(1_200);
  const [strategy, setStrategy] = useState<'buy_hold' | 'brrrr' | 'flip' | 'str'>('buy_hold');
  const [downPct, setDownPct] = useState(0.2);
  const [interestRate, setInterestRate] = useState(0.065);
  const [opexPct, setOpexPct] = useState(0.5);
  const [arv, setArv] = useState(250_000);
  const [rehabBudget, setRehabBudget] = useState(50_000);
  const [strAdr, setStrAdr] = useState(200);

  const showArv = strategy === 'flip' || strategy === 'brrrr';
  const showAdr = strategy === 'str';

  const result = useMemo(() => {
    if (!price || !rent) return null;

    const inputs: PropertyInputs = {
      price,
      monthlyRent: rent,
      sqft,
      hoaMonthly: hoa,
      arv: showArv ? arv : undefined,
      rehabBudget: showArv ? rehabBudget : undefined,
    };

    const cfg: RuleConfig = {
      strategy,
      downPaymentPct: downPct,
      interestRate,
      loanTermYears: 30,
      closingCostPct: 0.03,
      propertyTaxRate: taxRate,
      insuranceAnnual: insurance,
      fiftyPctOpexRatio: opexPct,
      targetRatio: 0.01,
      targetCapRate: 0.06,
      targetCoc: 0.08,
      arvDiscount: 0.7,
      rehabPerSqft: 40,
      strOccupancy: 0.65,
      strAdr: showAdr ? strAdr : undefined,
    };

    const ev = evaluateRules(inputs, cfg, { strategy });
    const score = compositeScore(inputs, ev);
    return { ev, score };
  }, [price, rent, sqft, hoa, taxRate, insurance, strategy, downPct, interestRate, opexPct, arv, rehabBudget, strAdr, showArv, showAdr]);

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <header className="mb-10">
          <Link href="/" className="text-sm text-haze hover:text-foreground transition-colors">&larr; Home</Link>
          <h1 className="display-1 mt-2 mb-2">Financial Calculator</h1>
          <p className="text-[15px] text-haze">Enter a property&rsquo;s numbers and adjust financing to see cap rate, cash-on-cash return, and the system&rsquo;s grade.</p>
        </header>

        <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
          {/* Inputs */}
          <div className="space-y-5 rounded-[var(--r-panel)] border border-line bg-card p-6">
            <p className="prov inline-block">inputs</p>

            <NumInput label="Purchase price" value={price} onChange={(v) => setPrice(v || 0)} prefix="$" />
            <NumInput label="Monthly rent (gross)" value={rent} onChange={(v) => setRent(v || 0)} prefix="$" />
            <NumInput label="Square footage" value={sqft} onChange={(v) => setSqft(v || 0)} />
            <NumInput label="HOA fee / mo" value={hoa} onChange={(v) => setHoa(v || 0)} prefix="$" />
            <NumInput label="Annual insurance" value={insurance} onChange={(v) => setInsurance(v || 0)} prefix="$" />

            <div>
              <p className="text-xs text-haze mb-1">Property tax rate</p>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0.004}
                  max={0.025}
                  step={0.001}
                  value={taxRate}
                  onChange={(e) => setTaxRate(Number(e.target.value))}
                  className="flex-1 accent-[#0e7a52]"
                />
                <span className="figure text-sm tabular-nums w-14 text-right">{fpct(taxRate)}</span>
              </div>
            </div>

            <div className="pt-2">
              <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">Strategy</p>
              <div className="flex flex-wrap gap-2">
                {(['buy_hold', 'brrrr', 'flip', 'str'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStrategy(s)}
                    className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors ${
                      strategy === s ? 'border-pass bg-pass/10 text-pass' : 'border-line text-haze hover:text-foreground'
                    }`}
                  >
                    {STRATEGY_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>

            {showArv && (
              <>
                <NumInput label="After-repair value (ARV)" value={arv} onChange={(v) => setArv(v || 0)} prefix="$" />
                <NumInput label="Rehab budget" value={rehabBudget} onChange={(v) => setRehabBudget(v || 0)} prefix="$" />
              </>
            )}

            {showAdr && (
              <NumInput label="Average daily rate (ADR)" value={strAdr} onChange={(v) => setStrAdr(v || 0)} prefix="$" />
            )}

            <Slider label="Down payment" value={downPct} onChange={setDownPct} format={fpct} min={0.05} max={0.5} step={0.05} />
            <Slider label="Interest rate" value={interestRate} onChange={setInterestRate} format={fpct} min={0.03} max={0.10} step={0.005} />
            <Slider label="Opex ratio (50% rule)" value={opexPct} onChange={setOpexPct} format={fpct} min={0.3} max={0.7} step={0.05} />
          </div>

          {/* Results */}
          <div>
            <div className="sticky top-28 space-y-5 rounded-[var(--r-panel)] border border-line bg-card p-6">
              <p className="prov inline-block">results</p>

              {result ? (
                <>
                  {/* Grade */}
                  <div className="flex items-center gap-4">
                    <div
                      className="grid h-16 w-16 shrink-0 place-items-center rounded-full text-2xl font-bold font-mono"
                      style={{
                        background: result.score.grade === 'A' || result.score.grade === 'B' ? 'var(--pass-dim)' : result.score.grade === 'C' ? 'var(--brass-dim)' : 'rgba(194,59,52,.12)',
                        color: result.score.grade === 'A' || result.score.grade === 'B' ? 'var(--pass-hi)' : result.score.grade === 'C' ? 'var(--brass-hi)' : 'var(--loss)',
                      }}
                    >
                      {result.score.grade}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{result.score.headline}</p>
                      <p className="text-xs text-haze">{result.score.score}/100</p>
                    </div>
                  </div>

                  {/* Key metrics */}
                  <div className="space-y-3 text-sm">
                    <MetricRow label="Cap rate" value={result.ev.metrics.capRate != null ? fpct(result.ev.metrics.capRate) : '\u2014'} positive />
                    <MetricRow label="Cash-on-cash" value={result.ev.metrics.cashOnCash != null ? fpct(result.ev.metrics.cashOnCash) : '\u2014'} positive />
                    <MetricRow
                      label="Monthly cashflow"
                      value={(() => {
                        const cf = result.ev.metrics.annualCashflow;
                        if (cf == null) return '\u2014';
                        const m = cf / 12;
                        return `${m >= 0 ? '+' : ''}${usd0.format(Math.abs(Math.round(m)))}`;
                      })()}
                      positive={result.ev.metrics.annualCashflow != null ? result.ev.metrics.annualCashflow >= 0 : false}
                    />
                    <MetricRow label="Down payment" value={result.ev.metrics.downPayment != null ? usd0.format(Math.round(result.ev.metrics.downPayment)) : '\u2014'} />
                    <MetricRow label="Closing costs" value={result.ev.metrics.closingCosts != null ? usd0.format(Math.round(result.ev.metrics.closingCosts)) : '\u2014'} />
                    <MetricRow label="Principal & interest" value={result.ev.metrics.monthlyPi != null ? usd0.format(Math.round(result.ev.metrics.monthlyPi)) : '\u2014'} />
                  </div>

                  {/* Pros / Cons */}
                  {result.score.pros.length + result.score.cons.length > 0 && (
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      {result.score.pros.length > 0 && (
                        <div>
                          <p className="font-semibold text-pass mb-1">Pros</p>
                          <ul className="space-y-0.5">
                            {result.score.pros.slice(0, 4).map((p, i) => <li key={i} className="text-foreground">✓ {p}</li>)}
                          </ul>
                        </div>
                      )}
                      {result.score.cons.length > 0 && (
                        <div>
                          <p className="font-semibold" style={{ color: 'var(--loss)' }}>Cons</p>
                          <ul className="space-y-0.5">
                            {result.score.cons.slice(0, 4).map((c, i) => <li key={i} className="text-foreground">✗ {c}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  <Link
                    href={`/search?q=${encodeURIComponent(`${Math.round(price / 1000)}k price ${rent} rent`)}`}
                    className="block w-full text-center rounded-full bg-pass px-6 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                  >
                    Find Properties Like This
                  </Link>
                </>
              ) : (
                <p className="text-sm text-haze">Enter a purchase price and monthly rent to see the analysis.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function NumInput({ label, value, onChange, prefix, step }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  prefix?: string;
  step?: number;
}) {
  return (
    <div>
      <p className="text-xs text-haze mb-1">{label}</p>
      <div className="relative">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-haze">{prefix}</span>}
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(Number(e.target.value.replace(/[^0-9.-]/g, '')))}
          step={step ?? 1000}
          className="w-full rounded-xl border border-line bg-ink-2 px-3 py-2.5 text-sm text-foreground tabular-nums outline-none focus:border-pass/50 transition-colors"
          style={{ paddingLeft: prefix ? '1.75rem' : '0.75rem' }}
        />
      </div>
    </div>
  );
}

function Slider({ label, value, onChange, format, min, max, step }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-haze">{label}</span>
        <span className="font-mono text-foreground tabular-nums">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[#0e7a52]"
      />
    </div>
  );
}

function MetricRow({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  const color = positive != null
    ? (positive ? 'var(--pass-hi)' : 'var(--loss)')
    : 'var(--foreground)';
  return (
    <div className="flex justify-between">
      <span className="text-haze">{label}</span>
      <span className="figure" style={{ color }}>{value}</span>
    </div>
  );
}
