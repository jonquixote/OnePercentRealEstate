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
    expect(sql).toMatch(/price\s*>=\s*30000/i);
    expect(sql).toMatch(/rent_price_ratio\s*>=\s*0.01/i);
    // Mirrors RENT_TRUST.maxRatio (0.02) from apps/one/src/lib/rent-trust.ts.
    // Bulk-feed SQL proxy for the absolute plausibility ceiling; the trusted
    // spotlight hero must also satisfy it (no HUD/comp joins here). Threshold
    // values must be kept identical to RENT_TRUST.maxRatio; both cite each other.
    expect(sql).toMatch(/rent_price_ratio\s*<=\s*0\.02/i);
    expect(sql).toMatch(/ST_DWithin/i);
    // Lifecycle: the hero must be a live listing — never a sold/stale/misfiled row.
    expect(sql).toMatch(/listing_status\s*=\s*'active'/i);
  });
});

describe('shapeSpotlight', () => {
  it('computes ratio as a fraction and passes through band', () => {
    const s = shapeSpotlight(
      { id: 1, address: '1 Main', zip_code: '77002', listing_price: '200000', estimated_rent: '2200',
        rent_low: '2000', rent_high: '2400', primary_photo: 'x.jpg' },
    );
    expect(s).not.toBeNull();
    expect(s!.ratio).toBeCloseTo(0.011, 3);
    expect(s!.zip).toBe('77002');
  });
  it('returns null when price or rent missing (never a broken hero)', () => {
    expect(shapeSpotlight({ id: 1, address: 'x', listing_price: null, estimated_rent: '2200' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Server-side accessors (spotlightFor / getSpotlightTour).
//
// These execute the query rather than just building it, so they need a mocked
// pool. vi.mock is hoisted, so the mocks below apply to the dynamic imports
// inside each test.
// ---------------------------------------------------------------------------
import { vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db', () => ({ default: { query: h.query } }));
vi.mock('@/lib/metros', () => {
  const METROS = [
    { slug: 'hou', label: 'Houston', zip: '77002', lat: 29.76, lng: -95.37, city: 'Houston', state: 'TX' },
    { slug: 'cle', label: 'Cleveland', zip: '44113', lat: 41.48, lng: -81.7, city: 'Cleveland', state: 'OH' },
    { slug: 'tpa', label: 'Tampa', zip: '33602', lat: 27.95, lng: -82.46, city: 'Tampa', state: 'FL' },
  ];
  return { METROS, DEFAULT_METRO: METROS[0], metroByZip: () => null, nearestMetro: () => METROS[0] };
});

const M = (i: number) => ([
  { slug: 'hou', label: 'Houston', zip: '77002', lat: 29.76, lng: -95.37, city: 'Houston', state: 'TX' },
  { slug: 'cle', label: 'Cleveland', zip: '44113', lat: 41.48, lng: -81.7, city: 'Cleveland', state: 'OH' },
  { slug: 'tpa', label: 'Tampa', zip: '33602', lat: 27.95, lng: -82.46, city: 'Tampa', state: 'FL' },
][i]);

const srow = (addr: string) => ({
  id: 1, address: addr, zip_code: '77002',
  listing_price: '90000', estimated_rent: '1200', primary_photo: null,
});

beforeEach(() => { h.query.mockReset(); vi.resetModules(); });

describe('getSpotlightTour', () => {
  it('fans out in PARALLEL — every query starts before any resolves', async () => {
    let started = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    h.query.mockImplementation(async () => { started += 1; await gate; return { rows: [srow('1 Main St')] }; });

    const { getSpotlightTour } = await import('./spotlight');
    const p = getSpotlightTour(M(0) as never);
    await Promise.resolve(); await Promise.resolve();
    expect(started).toBe(3);   // a serial `for (…) await` loop would be 1
    release();
    await p;
  });

  it('computes startIndex against the FILTERED array', async () => {
    h.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [srow('2 Lake Ave')] })
      .mockResolvedValueOnce({ rows: [srow('3 Bay St')] });
    const { getSpotlightTour } = await import('./spotlight');
    const { entries, startIndex } = await getSpotlightTour(M(1) as never);
    expect(entries).toHaveLength(2);
    expect(startIndex).toBe(0);
    expect(entries[startIndex].metro.zip).toBe('44113');
  });

  it('returns -1 and omits the metro when the visitor has no local deal', async () => {
    h.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [srow('2 Lake Ave')] })
      .mockResolvedValueOnce({ rows: [srow('3 Bay St')] });
    const { getSpotlightTour } = await import('./spotlight');
    const { entries, startIndex } = await getSpotlightTour(M(0) as never);
    expect(startIndex).toBe(-1);
    expect(entries.some((e) => e.metro.zip === '77002')).toBe(false);
  });

  it('degrades one failing metro without losing the rest of the tour', async () => {
    h.query
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ rows: [srow('2 Lake Ave')] })
      .mockResolvedValueOnce({ rows: [srow('3 Bay St')] });
    const { getSpotlightTour } = await import('./spotlight');
    const { entries } = await getSpotlightTour(M(2) as never);
    expect(entries).toHaveLength(2);
  });

  it('every returned entry has a non-null deal', async () => {
    h.query.mockResolvedValue({ rows: [srow('1 Main St')] });
    const { getSpotlightTour } = await import('./spotlight');
    const { entries } = await getSpotlightTour(M(0) as never);
    expect(entries.every((e) => e.deal !== null)).toBe(true);
  });
});

describe('spotlightFor caching', () => {
  it('serves a repeat call for the same metro from cache', async () => {
    h.query.mockResolvedValue({ rows: [srow('1 Main St')] });
    const { spotlightFor } = await import('./spotlight');
    await spotlightFor(M(0) as never);
    const afterFirst = h.query.mock.calls.length;
    await spotlightFor(M(0) as never);
    expect(h.query.mock.calls.length).toBe(afterFirst);
  });
});
