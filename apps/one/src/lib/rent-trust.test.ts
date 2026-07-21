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
});
