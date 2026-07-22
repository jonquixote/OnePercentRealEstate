import { describe, it, expect } from 'vitest';
import { assessRent, RENT_TRUST } from './rent-trust';

const base = { price: 245000, modelRent: 2767, hudFmr: 1900, areaComp: 2950 };

describe('assessRent', () => {
  it('trusted when model agrees with HUD/comps and ratio is sane', () => {
    expect(assessRent(base).verdict).toBe('trusted');
  });
  it('implausible when monthly rent exceeds the absolute price ceiling', () => {
    // $45k home, $2,863/mo = 6.4% — far above RENT_TRUST.maxRatio (0.02)
    expect(assessRent({ price: 45000, modelRent: 2863, hudFmr: 1100, areaComp: 1200 }).verdict)
      .toBe('implausible');
  });
  it('implausible when the model dwarfs HUD FMR beyond the divergence cap', () => {
    // model 2.4x HUD with no comp support
    expect(assessRent({ price: 120000, modelRent: 2600, hudFmr: 1050, areaComp: null }).verdict)
      .toBe('implausible');
  });
  it('wide (not implausible) when model and comps disagree moderately', () => {
    expect(assessRent({ price: 245000, modelRent: 2767, hudFmr: 1900, areaComp: 2100 }).verdict)
      .toBe('wide');
  });
  it('trusted with missing HUD/comps if the ratio is plainly sane (falls back to ratio only)', () => {
    expect(assessRent({ price: 245000, modelRent: 2400, hudFmr: null, areaComp: null }).verdict)
      .toBe('trusted');
  });
  it('returns the ratio and a human reason string', () => {
    const r = assessRent({ price: 45000, modelRent: 2863, hudFmr: 1100, areaComp: 1200 });
    expect(r.ratio).toBeCloseTo(0.0636, 4);
    expect(r.reason).toMatch(/exceeds|disagree/i);
  });
  it('rejects non-finite anchors (Infinity areaComp does not corroborate)', () => {
    // $45k home, 6.4% ratio, modelRent=2863, hudFmr=1100, areaComp=Infinity
    // Without the finite guard, Infinity/2863=0 would make compCorroborates=true
    // and drop the ratio>0.02 implausible branch — the verdict would leak "trusted".
    expect(
      assessRent({ price: 45000, modelRent: 2863, hudFmr: 1100, areaComp: Infinity }).verdict,
    ).toBe('implausible');
  });
  it('rejects non-finite anchors (Infinity hudFmr does not corroborate implausible)', () => {
    // hudFmr=Infinity makes modelRent/hudFmr = 0, suppressing the HUD-divergence
    // implausible branch. Must still catch via the ratio ceiling.
    expect(
      assessRent({ price: 45000, modelRent: 2863, hudFmr: Infinity, areaComp: null }).verdict,
    ).toBe('implausible');
  });
  it('rejects negative/zero anchors (treated as missing, not corroborating)', () => {
    // zero/negative anchors are skipped; with sane ratio + valid comp the
    // verdict is still trusted — the sanitizer just doesn't let bad anchors
    // falsely corroborate.
    expect(assessRent({ price: 245000, modelRent: 2767, hudFmr: 0, areaComp: 1200 }).verdict).toBe('trusted');
    expect(assessRent({ price: 245000, modelRent: 2767, hudFmr: -50, areaComp: 1200 }).verdict).toBe('trusted');
    // implausible still holds when ratio itself breaches even with bad anchors
    expect(assessRent({ price: 45000, modelRent: 2863, hudFmr: 0, areaComp: 1200 }).verdict).toBe('implausible');
  });
});
