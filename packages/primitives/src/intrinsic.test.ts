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

import { ownerReturn10yr } from './intrinsic';

describe('ownerReturn10yr', () => {
  const base = {
    price: 200000, downPct: 0.2, monthlyRent: 2000, opexRatio: 0.45,
    appreciationRate: 0.03, rentGrowthRate: 0.03, mortgageRate: 0.07,
  };
  it('produces 10 yearly rows with growing property value', () => {
    const r = ownerReturn10yr(base);
    expect(r.years).toHaveLength(10);
    expect(r.years[9].propertyValue).toBeGreaterThan(base.price);
    // 200k appreciating 3%/yr for 10y ≈ 268.8k
    expect(r.years[9].propertyValue).toBeCloseTo(268783, -2);
  });
  it('equity in year 10 exceeds the initial down payment (amortization + appreciation)', () => {
    const r = ownerReturn10yr(base);
    expect(r.years[9].equity).toBeGreaterThan(base.price * base.downPct);
  });
  it('reports an equity multiple > 1 for a sane deal', () => {
    expect(ownerReturn10yr(base).equityMultiple).toBeGreaterThan(1);
  });
  it('handles all-cash (downPct = 1, no debt service)', () => {
    const r = ownerReturn10yr({ ...base, downPct: 1 });
    expect(r.years[0].cumCashFlow).toBeGreaterThan(0); // no mortgage → positive year 1
  });
});
