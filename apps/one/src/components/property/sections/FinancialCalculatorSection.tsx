'use client';

import { useState, useMemo } from 'react';
import { evaluateRules, compositeScore, type PropertyInputs, type RuleConfig } from '@oper/primitives';

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fpct = (v: number) => `${(v * 100).toFixed(1)}%`;

interface Props {
  property: any;
}

export function FinancialCalculatorSection({ property }: Props) {
  const [strategy, setStrategy] = useState<'buy_hold' | 'brrrr' | 'flip' | 'str'>('buy_hold');
  const [downPct, setDownPct] = useState(0.2);
  const [interestRate, setInterestRate] = useState(0.065);

  const result = useMemo(() => {
    const price = Number(property.listing_price) || 0;
    const rent = Number(property.estimated_rent) || 0;
    if (!price || !rent) return null;

    const inputs: PropertyInputs = {
      price,
      monthlyRent: rent,
      sqft: property.financial_snapshot?.sqft ?? property.sqft ?? 0,
      hoaMonthly: property.hoa_fee ?? 0,
      yearBuilt: property.raw_data?.year_built || 0,
      daysOnMarket: property.days_on_market ?? -1,
      taxAnnualAmount: property.tax_annual_amount ?? null,
      assessedValue: property.assessed_value ?? null,
      arv: property.estimated_value ?? null,
      rehabBudget: null,
    };

    const cfg: RuleConfig = {
      strategy,
      downPaymentPct: downPct,
      interestRate,
      loanTermYears: 30,
      closingCostPct: 0.03,
      propertyTaxRate: 0.012,
      insuranceAnnual: property.insurance_state_avg ?? 1200,
      fiftyPctOpexRatio: 0.5,
      targetRatio: 0.01,
      targetCapRate: 0.06,
      targetCoc: 0.08,
      arvDiscount: 0.7,
      rehabPerSqft: 40,
      strOccupancy: 0.65,
    };

    const ev = evaluateRules(inputs, cfg, { strategy });
    const score = compositeScore(inputs, ev);
    return { ev, score };
  }, [property, strategy, downPct, interestRate]);

  return (
    <div className="space-y-6 rounded-2xl border border-line bg-card p-6">
      <p className="prov inline-block">financial calculator</p>

      {/* Strategy + sliders */}
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-4">
          <div>
            <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">Strategy</p>
            <div className="flex flex-wrap gap-2">
              {(['buy_hold', 'brrrr', 'flip', 'str'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStrategy(s)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                    strategy === s ? 'border-pass bg-pass/10 text-pass' : 'border-line text-haze hover:text-foreground'
                  }`}
                >
                  {s === 'buy_hold' ? 'Buy & Hold' : s === 'brrrr' ? 'BRRRR' : s === 'flip' ? 'Buy & Flip' : 'Short-Term'}
                </button>
              ))}
            </div>
          </div>

          <Slider label="Down payment" value={downPct} onChange={setDownPct} format={fpct} min={0.05} max={0.5} step={0.05} />
          <Slider label="Interest rate" value={interestRate} onChange={setInterestRate} format={fpct} min={0.03} max={0.10} step={0.005} />
          <p className="text-xs text-haze mt-4">Expenses estimated via the 50% rule — operating costs are modelled at half of gross rent.</p>
        </div>

        {/* Results */}
        {result && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="grid h-14 w-14 place-items-center rounded-full text-xl font-bold font-mono"
                style={{
                  background: result.score.grade === 'A' || result.score.grade === 'B' ? 'var(--pass-dim)' : result.score.grade === 'C' ? 'var(--brass-dim)' : 'rgba(194,59,52,.12)',
                  color: result.score.grade === 'A' || result.score.grade === 'B' ? 'var(--pass-hi)' : result.score.grade === 'C' ? 'var(--brass-hi)' : 'var(--loss)',
                }}>
                {result.score.grade}
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{result.score.headline}</p>
                <p className="text-xs text-haze">{result.score.score}/100</p>
              </div>
            </div>

            <div className="text-sm space-y-2">
              {(['Cap rate', 'Cash-on-cash', 'Monthly cashflow'] as const).map((label) => {
                const val = label === 'Cap rate' ? result.ev.metrics.capRate
                  : label === 'Cash-on-cash' ? result.ev.metrics.cashOnCash
                  : result.ev.metrics.annualCashflow ? result.ev.metrics.annualCashflow / 12 : null;
                return (
                  <div key={label} className="flex justify-between">
                    <span className="text-haze">{label}</span>
                    <span className={`figure ${val != null && val >= 0 ? 'figure--pass' : 'figure--loss'}`}>
                      {val != null
                        ? label === 'Monthly cashflow'
                          ? `${val >= 0 ? '+' : ''}${usd0.format(Math.abs(Math.round(val)))}`
                          : fpct(val)
                        : '\u2014'}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Pros / Cons */}
            {(result.score.pros.length > 0 || result.score.cons.length > 0) && (
              <div className="grid grid-cols-2 gap-2 text-xs">
                {result.score.pros.length > 0 && (
                  <div>
                    <p className="font-semibold text-pass mb-1">Pros</p>
                    <ul className="space-y-0.5">
                      {result.score.pros.slice(0, 3).map((p, i) => <li key={i} className="text-foreground">✓ {p}</li>)}
                    </ul>
                  </div>
                )}
                {result.score.cons.length > 0 && (
                  <div>
                    <p className="font-semibold" style={{ color: 'var(--loss)' }}>Cons</p>
                    <ul className="space-y-0.5">
                      {result.score.cons.slice(0, 3).map((c, i) => <li key={i} className="text-foreground">✗ {c}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
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
