import { describe, it, expect } from 'vitest';
import { buildSpotlightQuery, shapeSpotlight } from './spotlight';

describe('buildSpotlightQuery', () => {
  it('parameterizes every user-derived value (no interpolation)', () => {
    const { sql, params } = buildSpotlightQuery({ zip: '77002', lat: 29.75, lng: -95.36 });
    expect(sql).not.toContain('77002');
    expect(sql).not.toContain('29.75');
    expect(params).toEqual(expect.arrayContaining(['77002']));
    // Ranks the best 1%-clearing deal near the point, one row.
    expect(sql).toMatch(/ORDER BY/i);
    expect(sql).toMatch(/LIMIT 1/);
  });
  it('only considers live, rentable, priced listings that clear the line', () => {
    const { sql } = buildSpotlightQuery({ zip: '77002', lat: 29.75, lng: -95.36 });
    expect(sql).toMatch(/estimated_rent\s*>\s*0/i);
    expect(sql).toMatch(/price\s*>\s*0/i);
    expect(sql).toMatch(/estimated_rent\s*\/\s*price\s*\)?\s*>=\s*0.01/i);
  });
});

describe('shapeSpotlight', () => {
  it('computes ratio as a fraction and passes through band', () => {
    const s = shapeSpotlight(
      { id: 1, address: '1 Main', listing_price: '200000', estimated_rent: '2200',
        rent_low: '2000', rent_high: '2400', primary_photo: 'x.jpg' },
      '77002',
    );
    expect(s).not.toBeNull();
    expect(s!.ratio).toBeCloseTo(0.011, 3);
    expect(s!.metroZip).toBe('77002');
  });
  it('returns null when price or rent missing (never a broken hero)', () => {
    expect(shapeSpotlight({ id: 1, address: 'x', listing_price: null, estimated_rent: '2200' }, '77002')).toBeNull();
  });
});
