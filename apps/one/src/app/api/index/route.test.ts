import { describe, it, expect } from 'vitest';
import { toSnapshotRows } from '@/lib/index-data';

describe('toSnapshotRows', () => {
  it('maps DB rows to the primitive SnapshotRow shape', () => {
    const rows = toSnapshotRows([
      { metro_slug: 'houston', metro_label: 'Houston', pct_clearing: '0.55', median_ratio: '0.011', live_count: '200' },
    ]);
    expect(rows[0]).toEqual({ metroSlug: 'houston', metroLabel: 'Houston', pctClearing: 0.55, medianRatio: 0.011, liveCount: 200 });
  });
  it('preserves a null median ratio', () => {
    expect(toSnapshotRows([{ metro_slug: 'x', metro_label: 'X', pct_clearing: '0', median_ratio: null, live_count: '0' }])[0].medianRatio).toBeNull();
  });
});
