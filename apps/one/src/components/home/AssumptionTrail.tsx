import type { LensAssumptions } from '@/lib/underwrite-deal';

const usd0 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/** How precisely the rule matched this property, in plain words. */
const TIER: Record<string, string> = {
  exact: 'this property type and sale type',
  type_standard: 'this property type',
  default_saletype: 'this sale type, default property type',
  default_standard: 'our default rule',
};

/**
 * The assumptions behind the verdict, stated plainly.
 *
 * A number without its assumptions is a claim; with them it is an argument. The
 * match tier matters most: a rule resolved at DEFAULT is weaker evidence than
 * one matched on the exact property type, and presenting both with equal
 * confidence would be the quiet kind of dishonesty.
 *
 * A native <details> so this costs no client JavaScript.
 */
export function AssumptionTrail({ assumptions: a }: { assumptions: LensAssumptions }) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-[12px]" style={{ color: 'var(--haze)' }}>
        How we underwrote this
      </summary>

      <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-[12px]" style={{ color: 'var(--mute)' }}>
        <dt>Down payment</dt>
        <dd className="figure">{(a.downPaymentPct * 100).toFixed(0)}%</dd>

        <dt>Interest rate</dt>
        <dd className="figure">{(a.interestRate * 100).toFixed(2)}%</dd>

        <dt>Operating expenses</dt>
        <dd className="figure">{(a.opexRatio * 100).toFixed(0)}% of rent</dd>

        <dt>Rule matched on</dt>
        <dd>
          {TIER[a.resolvedTier ?? ''] ?? 'our default rule'}
          {a.isProvisional ? ' (provisional)' : ''}
        </dd>

        {a.arv != null && (
          <>
            <dt>After-repair value</dt>
            <dd className="figure">
              {usd0.format(a.arv)}
              {a.arvCompCount != null && (
                <span style={{ color: 'var(--haze)' }}> · {a.arvCompCount} comps</span>
              )}
            </dd>
          </>
        )}

        {a.ruleVersion && (
          <>
            <dt>Rule version</dt>
            <dd>{a.ruleVersion}</dd>
          </>
        )}
      </dl>

      <p className="mt-2 text-[11px] leading-snug" style={{ color: 'var(--haze)' }}>
        Rent is an estimate from our model, not a listed rent.
        {a.arv != null && ' The after-repair value is the median price per square foot of recent nearby sales of the same property type and comparable size.'}{' '}
        Every figure here recomputes nightly.
      </p>
    </details>
  );
}
