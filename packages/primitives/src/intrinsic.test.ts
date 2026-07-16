import { describe, it, expect } from 'vitest';
import { intrinsicValue, marginOfSafety } from './intrinsic';

describe('intrinsicValue (income approach)', () => {
  it('values a property at NOI / cap rate', () => {
    // rent 2000/mo → 24000/yr; opex 45% → NOI 13200; cap 6.6% → ~200000
    expect(intrinsicValue({ monthlyRent: 2000, opexRatio: 0.45, marketCapRate: 0.066 }))
      .toBeCloseTo(200000, -2); // within ~100
  });
  it('returns 0 for a non-positive cap rate (avoid divide-by-zero blowups)', () => {
    expect(intrinsicValue({ monthlyRent: 2000, opexRatio: 0.45, marketCapRate: 0 })).toBe(0);
  });
});

describe('marginOfSafety', () => {
  it('is positive when intrinsic exceeds price', () => {
    expect(marginOfSafety(200000, 160000)).toBeCloseTo(0.2, 5);
  });
  it('is negative (overpaying) when price exceeds intrinsic', () => {
    expect(marginOfSafety(200000, 240000)).toBeCloseTo(-0.2, 5);
  });
  it('returns 0 when intrinsic is 0', () => {
    expect(marginOfSafety(0, 160000)).toBe(0);
  });
});
