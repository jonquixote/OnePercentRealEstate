import Link from 'next/link';
import type { LensVerdict } from '@/lib/underwrite-deal';
import { STRATEGY_BY_ID } from '@/lib/strategies';
import { AssumptionTrail } from './AssumptionTrail';

/**
 * The chosen buyer's verdict on this property, in full.
 *
 * This is the page's actual argument: not "here is a listing" but "here is what
 * this listing does for *you*, and here is every test it passed or failed to
 * get there". Each metric shows its threshold alongside its value, because a
 * cap rate of 5.2% means nothing until you know it was measured against 5.0%.
 */
export function ActiveVerdict({
  verdict,
  fallback,
}: {
  verdict: LensVerdict;
  /** A lens we CAN compute for this property, offered when the chosen one is unavailable. */
  fallback?: LensVerdict | null;
}) {
  const meta = STRATEGY_BY_ID[verdict.strategy];

  if (!verdict.available) {
    const fb = fallback && fallback.available ? fallback : null;
    return (
      <div className="mat mt-4 p-4">
        <p className="prov">{meta.label}</p>
        <p className="mt-2 text-[14px] leading-snug" style={{ color: 'var(--haze)' }}>
          {verdict.reason}
        </p>
        <p className="mt-2 text-[12px]" style={{ color: 'var(--mute)' }}>
          We would rather say nothing than show you a number we cannot defend.
        </p>
        {/* Refusing is honest, but a refusal alone is a dead end. If another
            buyer's lens does have its inputs, point there rather than leaving
            the visitor with nothing. */}
        {fb && (
          <p className="mt-3 text-[13px]">
            <Link
              href={fb.strategy === 'buy_hold' ? '/' : `/?strat=${fb.strategy}`}
              scroll={false}
              className="underline underline-offset-2"
              style={{ color: 'var(--brass-hi)' }}
            >
              We can underwrite it as {STRATEGY_BY_ID[fb.strategy].label} — grade {fb.grade} →
            </Link>
          </p>
        )}
      </div>
    );
  }

  const passed = verdict.metrics.filter((m) => m.met === true).length;

  return (
    <div className="mat mt-4 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="prov">{meta.label}</p>
        <p className="text-[11px]" style={{ color: 'var(--mute)' }}>
          {passed} of {verdict.metrics.length} tests passed
        </p>
      </div>

      <div className="mt-2 flex items-baseline gap-3">
        <span
          className="figure text-[40px] leading-none"
          style={{ color: verdict.grade === 'A' || verdict.grade === 'B' ? 'var(--pass-hi)' : 'var(--text)' }}
        >
          {verdict.grade}
        </span>
        {verdict.headline && (
          <span className="text-[14px] leading-snug" style={{ color: 'var(--text)' }}>
            {verdict.headline}
          </span>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-1.5 text-[12px]">
        {verdict.metrics.map((m) => (
          <div key={m.label} className="flex items-baseline justify-between gap-2">
            <dt style={{ color: 'var(--haze)' }}>{m.label}</dt>
            <dd className="figure whitespace-nowrap" style={{ color: m.met === false ? 'var(--loss)' : 'var(--text)' }}>
              {m.value}
              {m.threshold && (
                <span style={{ color: 'var(--mute)' }}> / {m.threshold}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>

      {verdict.assumptions && <AssumptionTrail assumptions={verdict.assumptions} />}
    </div>
  );
}
