import { describe, it, expect } from 'vitest';
import { shapeSnapshotRows, buildSnapshotQuery } from './index-snapshot';

const metros = [
  { slug: 'houston', label: 'Houston', zip3: ['770'], repZip: '77002' },
  { slug: 'tampa', label: 'Tampa', zip3: ['336'], repZip: '33604' },
];

describe('buildSnapshotQuery', () => {
  it('counts only active (live) inventory — sold/stale/misfiled never inflate the index', () => {
    const { sql, params } = buildSnapshotQuery(metros);
    expect(sql).toMatch(/listing_status\s*=\s*'active'/i);
    // zip3/metro pairs remain fully parameterized (index-friendly VALUES join).
    expect(params).toEqual(['770', 'houston', '336', 'tampa']);
  });
});

describe('shapeSnapshotRows', () => {
  it('computes pct_clearing, attaches labels, and zero-fills absent metros (no gaps)', () => {
    const rows = shapeSnapshotRows(
      [{ metro_slug: 'houston', live_count: '200', clearing_count: '110', median_ratio: '0.0105' }],
      metros, '2026-07-01',
    );
    // Both metros present: houston filled, tampa zero-filled (contract = no gaps).
    expect(rows).toHaveLength(2);
    const houston = rows.find((r) => r.metro_slug === 'houston')!;
    const tampa = rows.find((r) => r.metro_slug === 'tampa')!;
    expect(houston.metro_label).toBe('Houston');
    expect(houston.pct_clearing).toBeCloseTo(0.55, 5);
    expect(houston.month).toBe('2026-07-01');
    expect(tampa.live_count).toBe(0);
    expect(tampa.clearing_count).toBe(0);
    expect(tampa.pct_clearing).toBe(0);
  });
  it('emits a zero row for a metro absent from the DB result (no gaps)', () => {
    const rows = shapeSnapshotRows([], metros, '2026-07-01');
    expect(rows).toHaveLength(2);
    expect(
      rows.every((r) => r.pct_clearing === 0 && r.live_count === 0 && r.clearing_count === 0),
    ).toBe(true);
  });
});
