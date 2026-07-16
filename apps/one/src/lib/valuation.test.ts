import { describe, it, expect } from 'vitest';
import { assembleInputs, computeValuation } from './valuation';

const row = {
  price: '200000', estimated_rent: '2000',
  opex_ratio: '0.45', down_payment_pct: '0.2',   // from underwriting_rules
  hpi_cagr_5yr: '0.04',                            // from fhfa_zip_hpi
  metro_cap_rate: '0.066',                         // derived ZIP median
};

describe('assembleInputs', () => {
  it('maps DB fields to typed inputs and records provenance', () => {
    const i = assembleInputs(row);
    expect(i.price).toBe(200000);
    expect(i.opexRatio).toBeCloseTo(0.45, 5);
    expect(i.marketCapRate).toBeCloseTo(0.066, 5);
    expect(i.provenance.join(' ')).toMatch(/underwriting_rules/);
  });
  it('falls back to documented defaults when rule fields are null, noting it', () => {
    const i = assembleInputs({ ...row, opex_ratio: null, down_payment_pct: null, metro_cap_rate: null });
    expect(i.opexRatio).toBe(0.5);   // default (50% rule)
    expect(i.downPct).toBe(0.2);      // default
    expect(i.marketCapRate).toBe(0.07); // default
    expect(i.provenance.join(' ')).toMatch(/default/i);
  });
});

describe('computeValuation', () => {
  it('produces intrinsic, margin of safety, and a 10-year projection', () => {
    const v = computeValuation(row);
    expect(v.intrinsic).toBeGreaterThan(0);
    expect(v.ownerReturn.years).toHaveLength(10);
    expect(typeof v.marginOfSafety).toBe('number');
  });
});
