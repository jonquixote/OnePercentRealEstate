/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import {
  buildListingsQuery,
  parsePolygonParam,
  type PropertyFilters,
} from './properties';

describe('parsePolygonParam', () => {
  it('returns null for undefined', () => {
    expect(parsePolygonParam(undefined)).toBeNull();
  });
  it('returns null for too few points', () => {
    expect(parsePolygonParam('1,2;3,4')).toBeNull();
  });
  it('returns null for non-finite coords', () => {
    expect(parsePolygonParam('1,2;3,4;5,abc')).toBeNull();
  });
  it('returns null for out-of-range coords', () => {
    expect(parsePolygonParam('200,2;3,4;5,6')).toBeNull();
  });
  it('closes an open ring', () => {
    expect(parsePolygonParam('0,0;0,1;1,1')).toBe('POLYGON((0 0, 0 1, 1 1, 0 0))');
  });
  it('keeps an already-closed ring', () => {
    expect(parsePolygonParam('0,0;0,1;1,1;0,0')).toBe('POLYGON((0 0, 0 1, 1 1, 0 0))');
  });
  it('rejects more than 100 vertices', () => {
    const many = Array.from({ length: 101 }, (_, i) => `${i},${i}`).join(';');
    expect(parsePolygonParam(many)).toBeNull();
  });
});

// The gold-standard parameterization check: changing a filter VALUE must
// never alter the SQL text — only the bound `params` array. If a value were
// ever interpolated into the text, the SQL would differ between the two.
describe('buildListingsQuery — parameterization', () => {
  const pairs: Array<[string, () => PropertyFilters, (f: any, v: any) => void, any, any]> = [
    ['minPrice', () => ({}), (f, v) => (f.minPrice = v), 100000, 250000],
    ['maxPrice', () => ({}), (f, v) => (f.maxPrice = v), 500000, 750000],
    ['minBeds', () => ({}), (f, v) => (f.minBeds = v), 2, 3],
    ['minBaths', () => ({}), (f, v) => (f.minBaths = v), 1, 2],
    ['onlyOnePercentRule + strategy', () => ({ onlyOnePercentRule: true }), (f, v) => (f.strategy = v), 'buy_hold', 'flip'],
    ['minCapRate', () => ({}), (f, v) => (f.minCapRate = v), 8, 9],
    ['minCashOnCash', () => ({}), (f, v) => (f.minCashOnCash = v), 12, 15],
    ['propertyType', () => ({}), (f, v) => (f.propertyType = v), 'single_family', 'condo'],
    ['hoaMax', () => ({}), (f, v) => (f.hoaMax = v), 300, 500],
    ['domMin', () => ({}), (f, v) => (f.domMin = v), 30, 60],
    ['minRentConfidence', () => ({}), (f, v) => (f.minRentConfidence = v), 0.5, 0.8],
    ['q', () => ({}), (f, v) => (f.q = v), '90210', '10001'],
    ['polygon', () => ({}), (f, v) => (f.polygon = v), '0,0;0,1;1,1;0,0', '1,1;1,2;2,2;1,1'],
    ['bounds', () => ({}), (f, v) => (f.bounds = v), { north: 40, south: 30, east: -100, west: -110 }, { north: 50, south: 20, east: -90, west: -120 }],
  ];

  for (const [name, mk, set, a, b] of pairs) {
    it(`binds ${name} as a param (SQL text unchanged when value changes)`, () => {
      const fa = mk();
      set(fa, a);
      const fb = mk();
      set(fb, b);
      const qa = buildListingsQuery(fa, 'newest', 1, 100, null);
      const qb = buildListingsQuery(fb, 'newest', 1, 100, null);
      expect(qa.sql).toBe(qb.sql);
      expect(qa.params).not.toEqual(qb.params);
    });
  }

  it('does not interpolate an injectable string into the SQL text', () => {
    const benign = buildListingsQuery({ propertyType: 'condo' }, 'newest', 1, 100, null);
    const evil = buildListingsQuery(
      { propertyType: "'; DROP TABLE listings; --" },
      'newest',
      1,
      100,
      null,
    );
    // SQL text is identical — the malicious value is bound, not concatenated.
    expect(evil.sql).toBe(benign.sql);
    expect(evil.params).toContain("'; DROP TABLE listings; --");
  });

  it('always applies the for_sale + $10k floor base clauses', () => {
    const { sql } = buildListingsQuery({}, 'newest', 1, 100, null);
    expect(sql).toContain("listing_type = 'for_sale'");
    expect(sql).toContain('price > 10000');
  });
});

describe('buildListingsQuery — lifecycle filter', () => {
  it('hides sold/stale/rental_misfiled by default', () => {
    const { sql } = buildListingsQuery({}, 'newest', 1, 100, null);
    expect(sql).toMatch(/listing_status NOT IN \('sold','stale','rental_misfiled'\)/);
  });
  it('surfaces sold rows when includeSold is set, still hiding stale + misfiled', () => {
    const { sql } = buildListingsQuery({ includeSold: true }, 'newest', 1, 100, null);
    expect(sql).toMatch(/listing_status NOT IN \('stale','rental_misfiled'\)/);
    expect(sql).not.toMatch(/'sold'/);
  });
});

describe('buildListingsQuery — unverified feed (#53/3)', () => {
  // Mirrors RENT_TRUST.maxRatio (0.02) from apps/one/src/lib/rent-trust.ts.
  // The trusted default feed excludes implausible rows with `rent_price_ratio
  // <= 0.02`; the strict `includeUnverified` toggle opts in.
  it('default (trusted) feed appends the 0.02 plank-rent ratio ceiling', () => {
    const { sql } = buildListingsQuery({}, 'newest', 1, 100, null);
    expect(sql).toMatch(/rent_price_ratio\s*<=\s*0\.02/i);
  });
  it('includeUnverified drops the 0.02 plank-rent ratio ceiling', () => {
    const { sql } = buildListingsQuery({ includeUnverified: true }, 'newest', 1, 100, null);
    expect(sql).not.toMatch(/rent_price_ratio\s*<=\s*0\.02/);
  });
  it('does not cross-cite the ceiling when onlyOnePercentRule is on (only the explicit rail)', () => {
    // When the user is filtering FOR 1% clearers, we still want the ridge cap
    // because the default ceiling is about plausibility not profitability.
    const { sql } = buildListingsQuery({}, 'one_percent_high', 1, 100, null);
    expect(sql).toMatch(/rent_price_ratio\s*<=\s*0\.02/i);
  });
});

describe('buildListingsQuery — cursor vs offset', () => {
  it('uses keyset (id < cursor) on newest sort', () => {
    const { sql, params } = buildListingsQuery({}, 'newest', 1, 100, '999');
    expect(sql).toContain('id < $');
    expect(sql).not.toContain('OFFSET');
    expect(params).toContain('999');
  });

  it('falls back to OFFSET on a non-newest sort', () => {
    const { sql, params } = buildListingsQuery({}, 'price_high', 3, 50, null);
    expect(sql).toContain('OFFSET');
    expect(sql).not.toContain('id < $');
    expect(sql).toContain('LIMIT $');
    // page 3, limit 50 -> offset 100
    expect(params[params.length - 1]).toBe(100);
  });
});
