/**
 * Is an ML result an actual rent estimate?
 *
 * `Number.isFinite(0)` is true, so a plain finiteness check accepts 0 as a
 * valid rent. That is how 36,979 listings ended up marked `done` while holding
 * `estimated_rent = 0` — the legacy "no rent" sentinel — and why the
 * listings_done_implies_rent CHECK constraint (which only asserts NOT NULL)
 * passed them all.
 *
 * A rent of zero is not an estimate. It is the absence of one.
 */
export function isScored(predictedRent: unknown): predictedRent is number {
  return typeof predictedRent === 'number' && Number.isFinite(predictedRent) && predictedRent > 0;
}
