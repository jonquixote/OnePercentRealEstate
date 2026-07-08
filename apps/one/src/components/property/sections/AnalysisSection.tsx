'use client';

import { useEffect, useState, useMemo } from 'react';
import { evaluateRules, compositeScore, resolveRuleFrom, type PropertyInputs, type RuleConfig } from '@oper/primitives';

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function AnalysisSection({ property, hudData, demographics }: { property: any; hudData: any; demographics: any }) {
  const [grade, setGrade] = useState<{ score: number; grade: string; headline: string; breakdown: any[]; pros: string[]; cons: string[] } | null>(null);
  const [strategy, setStrategy] = useState<'buy_hold' | 'brrrr' | 'flip' | 'str'>('buy_hold');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function compute() {
      setLoading(true);
      setError('');
      const price = Number(property.listing_price) || 0;
      const rent = Number(property.estimated_rent) || 0;
      if (!price || !rent) {
        setLoading(false);
        return;
      }

      const rulesData = await fetch('/api/underwriting-rules').then(r => r.json()).catch(() => null);
      const rules: RuleConfig[] = Array.isArray(rulesData) ? rulesData : [];
      const cfg = resolveRuleFrom(rules, { propertyType: property.raw_data?.property_type || 'sfr', saleType: property.sale_type || 'standard', strategy });
      if (!cfg) {
        if (!cancelled) { setLoading(false); setError('Could not resolve underwriting rules for this property.'); }
        return;
      }

      const sqft = property.financial_snapshot?.sqft ?? property.sqft ?? 0;
      const inputs: PropertyInputs = {
        price,
        monthlyRent: rent,
        sqft,
        hoaMonthly: property.hoa_fee ?? 0,
        yearBuilt: property.raw_data?.year_built || 0,
        daysOnMarket: property.days_on_market ?? -1,
        taxAnnualAmount: property.tax_annual_amount ?? null,
        assessedValue: property.assessed_value ?? null,
        arv: property.estimated_value ?? null,
        rehabBudget: null,
      };

      const ev = evaluateRules(inputs, cfg, { strategy });
      const result = compositeScore(inputs, ev);
      if (!cancelled) setGrade(result);
    }
    compute().finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [property, strategy]);

  return (
    <div className="space-y-6">
      {/* Strategy toggle */}
      <div className="flex gap-2">
        {(['buy_hold', 'brrrr', 'flip', 'str'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStrategy(s)}
            className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors ${
              strategy === s
                ? 'border-pass bg-pass/10 text-pass'
                : 'border-line text-haze hover:text-foreground'
            }`}
          >
            {s === 'buy_hold' ? 'Buy & Hold' : s === 'brrrr' ? 'BRRRR' : s === 'flip' ? 'Buy & Flip' : 'Short-Term'}
          </button>
        ))}
      </div>

      {grade ? (
        <div className="space-y-6 rounded-2xl border border-line bg-card p-6">
          {/* Score + grade */}
          <div className="flex items-center gap-4">
            <div
              className="grid h-16 w-16 place-items-center rounded-full text-2xl font-bold font-mono"
              style={{
                background: grade.grade === 'A' || grade.grade === 'B' ? 'var(--pass-dim)' : 'var(--brass-dim)',
                color: grade.grade === 'A' || grade.grade === 'B' ? 'var(--pass-hi)' : 'var(--brass-hi)',
              }}
            >
              {grade.grade}
            </div>
            <div>
              <p className="text-lg font-semibold text-foreground">{grade.headline}</p>
              <p className="text-sm text-haze">{grade.score}/100</p>
            </div>
          </div>

          {/* Breakdown bars */}
          {grade.breakdown.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Category breakdown</p>
              {grade.breakdown.map((cat: any, i: number) => (
                <div key={i}>
                  <div className="flex items-baseline justify-between text-sm mb-1">
                    <span className="text-haze">{cat.label}</span>
                    <span className="text-xs text-muted-foreground">{cat.points}/{cat.weight}</span>
                  </div>
                  <div className="band">
                    <div
                      className="band-fill"
                      style={{ width: `${cat.weight > 0 ? (cat.points / cat.weight) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pros / Cons */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {grade.pros.length > 0 && (
              <div>
                <p className="text-xs font-mono uppercase tracking-wider text-pass mb-2">Pros</p>
                <ul className="space-y-1">
                  {grade.pros.map((p, i) => (
                    <li key={i} className="text-sm text-foreground">\u2713 {p}</li>
                  ))}
                </ul>
              </div>
            )}
            {grade.cons.length > 0 && (
              <div>
                <p className="text-xs font-mono uppercase tracking-wider" style={{ color: 'var(--loss)' }}>Cons</p>
                <ul className="space-y-1">
                  {grade.cons.map((c, i) => (
                    <li key={i} className="text-sm text-foreground">\u2717 {c}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      ) : loading ? (
        <p className="text-sm text-haze">Computing analysis\u2026</p>
      ) : error ? (
        <p className="text-sm text-haze">{error}</p>
      ) : null}
    </div>
  );
}
