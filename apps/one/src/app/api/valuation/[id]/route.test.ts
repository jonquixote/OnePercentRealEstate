import { describe, it, expect } from 'vitest';
import { shapeResponse } from './route';
import { computeValuation } from '@/lib/valuation';

const v = computeValuation({
  price: '200000', estimated_rent: '2000', opex_ratio: '0.45',
  down_payment_pct: '0.2', metro_cap_rate: '0.066', hpi_cagr_5yr: '0.04',
});

describe('shapeResponse', () => {
  it('free tier gets headline + margin of safety but NOT the full projection', () => {
    const r = shapeResponse(v, false) as Record<string, unknown>;
    expect(r.intrinsic).toBeGreaterThan(0);
    expect(r.marginOfSafety).toBeDefined();
    expect(r.ownerReturn).toBeUndefined();
    expect(r.inputs).toBeUndefined();
  });
  it('pro tier gets the full projection + inputs', () => {
    const r = shapeResponse(v, true) as Record<string, unknown>;
    expect(r.ownerReturn).toBeDefined();
    expect(r.inputs).toBeDefined();
  });
});
