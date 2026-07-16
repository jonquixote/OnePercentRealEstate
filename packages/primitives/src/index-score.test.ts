import { describe, it, expect } from 'vitest';
import { rankSnapshots } from './index-score';

const cur = [
  { metroSlug: 'a', metroLabel: 'A', pctClearing: 0.30, medianRatio: 0.009, liveCount: 100 },
  { metroSlug: 'b', metroLabel: 'B', pctClearing: 0.55, medianRatio: 0.011, liveCount: 200 },
];
const prior = [
  { metroSlug: 'a', metroLabel: 'A', pctClearing: 0.25, medianRatio: 0.008, liveCount: 90 },
  { metroSlug: 'b', metroLabel: 'B', pctClearing: 0.60, medianRatio: 0.012, liveCount: 210 },
];

describe('rankSnapshots', () => {
  it('ranks by pct clearing descending', () => {
    const r = rankSnapshots(cur);
    expect(r[0].metroSlug).toBe('b');
    expect(r[0].rank).toBe(1);
    expect(r[1].rank).toBe(2);
  });
  it('computes momentum vs the prior month', () => {
    const r = rankSnapshots(cur, prior);
    expect(r.find((x) => x.metroSlug === 'a')!.momentum).toBeCloseTo(0.05, 5);
    expect(r.find((x) => x.metroSlug === 'b')!.momentum).toBeCloseTo(-0.05, 5);
  });
  it('momentum is null when there is no prior row for a metro', () => {
    const r = rankSnapshots(cur, [prior[0]]);
    expect(r.find((x) => x.metroSlug === 'b')!.momentum).toBeNull();
  });
});
