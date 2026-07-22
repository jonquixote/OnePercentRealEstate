/**
 * Bulk-feed SQL proxy: the trusted feeds (default search, spotlight, alert
 * candidates) approximate the absolute plausibility ceiling with
 * `rent_price_ratio <= 0.02` (no HUD/comp joins available in bulk). The SQL
 * predicate and RENT_TRUST.maxRatio must be kept identical; both cite each other
 * in comments. See apps/one/src/lib/queries/properties.ts and
 * apps/worker/src/alerts.ts.
 */
export const RENT_TRUST = {
  maxRatio: 0.02,
  hudDivergence: 1.6,
  compDivergence: 1.4,
} as const;

const MODERATE_DIVERGENCE = 1.25;

export type RentAssessmentInput = {
  price: number | null | undefined;
  modelRent: number | null | undefined;
  hudFmr?: number | null;
  areaComp?: number | null;
};

export type RentVerdict = 'trusted' | 'wide' | 'implausible';

export type RentAssessment = {
  verdict: RentVerdict;
  ratio: number;
  reason: string;
};

const compCorroborates = (modelRent: number, areaComp: number | null | undefined): boolean => {
  if (areaComp == null || !Number.isFinite(areaComp) || areaComp <= 0) return false;
  const r = modelRent / areaComp;
  return Number.isFinite(r) && r <= RENT_TRUST.compDivergence;
};

const ratioReasonable = (ratio: number): boolean =>
  Number.isFinite(ratio) && ratio <= RENT_TRUST.maxRatio;

const moderateDivergence = (a: number, b: number): boolean => {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return false;
  const r = a / b;
  if (!Number.isFinite(r)) return false;
  return r > MODERATE_DIVERGENCE || r < 1 / MODERATE_DIVERGENCE;
};

export function assessRent(input: RentAssessmentInput): RentAssessment {
  const { price, modelRent, hudFmr, areaComp } = input;

  if (price == null || !Number.isFinite(price) || price <= 0) {
    return { verdict: 'implausible', ratio: 0, reason: 'no price' };
  }
  if (modelRent == null || !Number.isFinite(modelRent) || modelRent <= 0) {
    return { verdict: 'implausible', ratio: 0, reason: 'no model rent' };
  }

  const ratio = modelRent / price;
  if (!Number.isFinite(ratio)) {
    return { verdict: 'implausible', ratio: 0, reason: 'uncomputable price-to-rent ratio' };
  }

  if (!ratioReasonable(ratio) && !compCorroborates(modelRent, areaComp)) {
    return {
      verdict: 'implausible',
      ratio,
      reason:
        'model disagrees with comps and ratio exceeds sane price-to-rent ceiling',
    };
  }

  const hudImplausible =
    hudFmr != null &&
    hudFmr > 0 &&
    Number.isFinite(hudFmr) &&
    (() => {
      const r = modelRent / hudFmr;
      return Number.isFinite(r) && r > RENT_TRUST.hudDivergence;
    })() &&
    !compCorroborates(modelRent, areaComp);
  if (hudImplausible) {
    return {
      verdict: 'implausible',
      ratio,
      reason: 'model disagrees with HUD FMR beyond divergence cap',
    };
  }

  const anchors = [
    hudFmr != null && hudFmr > 0 && Number.isFinite(hudFmr) ? moderateDivergence(modelRent, hudFmr) : null,
    areaComp != null && areaComp > 0 && Number.isFinite(areaComp) ? moderateDivergence(modelRent, areaComp) : null,
  ].filter((v): v is boolean => v !== null);

  // wide = meaningful disagreement BETWEEN anchors: only flag when ≥2 anchors are
  // present and all of them diverge moderately. Single-anchor moderate divergence
  // is not enough evidence of disagreement (could be noise in one source).
  if (anchors.length >= 2 && anchors.every(Boolean)) {
    return {
      verdict: 'wide',
      ratio,
      reason: 'model and anchors disagree moderately',
    };
  }

  return { verdict: 'trusted', ratio, reason: 'model agrees with anchors' };
}
