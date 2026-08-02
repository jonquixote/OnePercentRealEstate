import type { LensVerdict } from '@/lib/underwrite-deal';
import type { Strategy } from '@/lib/strategies';
import { ActiveVerdict } from './ActiveVerdict';
import { LensVerdictStrip } from './LensVerdictStrip';

/**
 * One property's full underwriting: the active buyer's verdict, then the other
 * three lenses in compact form.
 *
 * The metro tour rotates the card underneath, so a verdict is rendered for
 * every deal in the tour and swapped in lockstep with the card. Rendering only
 * the first deal's verdict would leave a detailed, confident-looking analysis
 * sitting beneath a different property six seconds later.
 */
export function DealVerdict({
  verdicts,
  strategy,
}: {
  verdicts: LensVerdict[];
  strategy: Strategy;
}) {
  const active = verdicts.find((v) => v.strategy === strategy) ?? null;
  const others = verdicts.filter((v) => v.strategy !== strategy);

  if (!active) return null;

  // STR is unavailable on every property and flip/BRRRR on most, so the chosen
  // lens is often one we cannot compute. Offer the nearest one we can.
  const fallback = active.available ? null : (others.find((v) => v.available) ?? null);

  return (
    <>
      <ActiveVerdict verdict={active} fallback={fallback} />
      <LensVerdictStrip verdicts={others} />
    </>
  );
}
