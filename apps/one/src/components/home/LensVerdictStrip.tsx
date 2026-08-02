import type { LensVerdict } from '@/lib/underwrite-deal';
import { STRATEGY_BY_ID } from '@/lib/strategies';

/**
 * The other buyer lenses on the same property, in compact form.
 *
 * Unavailable lenses stay visible with their reason. Hiding them would read as
 * "this property fails for a flipper", when the truth is usually "we don't have
 * the comps to say" — a different claim, and the only honest one.
 *
 * Server-rendered: the underwriting math never reaches the browser.
 */
export function LensVerdictStrip({ verdicts }: { verdicts: LensVerdict[] }) {
  if (verdicts.length === 0) return null;

  return (
    <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
      {verdicts.map((v) => {
        const meta = STRATEGY_BY_ID[v.strategy];
        return (
          <li key={v.strategy} className="mat p-3">
            <p className="prov">{meta.short}</p>
            {v.available ? (
              <>
                <p
                  className="figure mt-1.5 text-[22px] leading-none"
                  style={{ color: v.grade === 'A' || v.grade === 'B' ? 'var(--pass-hi)' : 'var(--text)' }}
                >
                  {v.grade}
                  <span className="sr-only"> grade for {meta.label}</span>
                </p>
                <p className="mt-1.5 text-[11px] leading-snug" style={{ color: 'var(--mute)' }}>
                  {v.metrics
                    .slice(0, 2)
                    .map((m) => `${m.label} ${m.value}`)
                    .join(' · ')}
                </p>
              </>
            ) : (
              <p className="mt-1.5 text-[11px] leading-snug" style={{ color: 'var(--haze)' }}>
                {v.reason}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
