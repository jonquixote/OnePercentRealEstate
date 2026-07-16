'use client';
import Link from 'next/link';

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export type ValuationPayload = {
  intrinsic: number;
  marginOfSafety: number;
  headline: string;
  ownerReturn?: {
    years: { year: number; equity: number; cumCashFlow: number; propertyValue: number }[];
    equityMultiple: number;
    avgAnnualCashOnCash: number;
  };
  inputs?: { provenance: string[] };
};

export function ValuationPanel({ valuation }: { valuation: ValuationPayload | null }) {
  if (!valuation || !(valuation.intrinsic > 0)) return null;
  const { intrinsic, marginOfSafety, headline, ownerReturn, inputs } = valuation;
  const positive = marginOfSafety >= 0;

  return (
    <>
      <div className="mat p-5">
        <p className="prov">Intrinsic value · income approach</p>
        <p className="figure mt-1 text-3xl" style={{ color: 'var(--text)' }}>{usd0.format(intrinsic)}</p>
        <span
          className="mt-3 inline-block rounded-full px-3 py-1 text-[12px] font-semibold"
          style={{ background: positive ? 'var(--pass)' : 'var(--brass)', color: 'var(--ink)' }}
        >
          {headline}
        </span>
        <p className="prov mt-3">Value = net operating income ÷ market cap rate. Not investment advice.</p>
      </div>

      {ownerReturn ? (
        <div className="mat p-5 mt-4">
          <p className="prov">Ten-year owner return · {(ownerReturn.avgAnnualCashOnCash * 100).toFixed(1)}% avg cash-on-cash</p>
          <p className="figure mt-1 text-3xl figure--pass">{ownerReturn.equityMultiple.toFixed(1)}×</p>
          <p className="prov">equity multiple on cash invested</p>
          <table className="mt-3 w-full text-[12px]" style={{ color: 'var(--text)' }}>
            <thead><tr style={{ color: 'var(--mute)' }}><th className="text-left">Yr</th><th className="text-right">Value</th><th className="text-right">Equity</th><th className="text-right">Cum. cash</th></tr></thead>
            <tbody>
              {ownerReturn.years.filter((y) => y.year % 2 === 1 || y.year === 10).map((y) => (
                <tr key={y.year}>
                  <td>{y.year}</td>
                  <td className="text-right tabular-nums">{usd0.format(y.propertyValue)}</td>
                  <td className="text-right tabular-nums">{usd0.format(y.equity)}</td>
                  <td className="text-right tabular-nums">{usd0.format(y.cumCashFlow)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {inputs?.provenance?.length ? <p className="prov mt-3">Assumptions: {inputs.provenance.join(' · ')}</p> : null}
        </div>
      ) : (
        <div className="mat p-5 mt-4">
          <p className="prov">Ten-year owner return</p>
          <p className="mt-2 text-[14px]" style={{ color: 'var(--haze)' }}>
            Equity multiple, per-year cash flow, and appreciation modeling are a Pro feature.
          </p>
          <Link href="/pricing" className="mt-3 inline-block rounded-[6px] px-4 py-2 text-[13px] font-semibold" style={{ background: 'var(--brass)', color: 'var(--ink)' }}>
            Unlock with Pro
          </Link>
        </div>
      )}
    </>
  );
}
