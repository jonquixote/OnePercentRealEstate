import { describe, it, expect } from 'vitest';
import baseline from './__fixtures__/stats-baseline.json';

/**
 * The /api/stats CONTRACT.
 *
 * The hero numbers are moving from an on-demand 18.5s aggregate (seq scan over
 * 1.3M listings) to a precomputed `stats_summary` row. That is a latency change
 * ONLY — every field the homepage renders must keep its meaning and its
 * relationships. These assertions encode the invariants that must survive the
 * refactor; the fixture is real prod output captured 2026-07-25 before it.
 *
 * Absolute counts drift as the crawler runs, so we assert SHAPE + INVARIANTS,
 * not byte equality. Task 5's deploy proof compares live output field-by-field
 * against this fixture within tolerance.
 */

export interface StatsPayload {
  total: number;
  onePercentPasses: number;
  medianRatioPct: number;
  markets: number;
  rentable: number;
  rentCalcPending: number;
  thresholdPct: number;
  strategy: string;
  histogram: Array<{ loPct: number; hiPct: number; count: number }>;
  medianRent?: number;
}

/** Every invariant the hero depends on. Reused by the route test after the refactor. */
export function assertStatsInvariants(s: StatsPayload): void {
  // Population sanity
  expect(s.total).toBeGreaterThan(0);
  expect(s.onePercentPasses).toBeGreaterThanOrEqual(0);
  expect(s.onePercentPasses).toBeLessThanOrEqual(s.total);
  expect(s.rentable).toBeLessThanOrEqual(s.total);

  // The hero prints these directly — they must never be null/NaN.
  for (const [k, v] of Object.entries({
    total: s.total,
    onePercentPasses: s.onePercentPasses,
    medianRatioPct: s.medianRatioPct,
    markets: s.markets,
    rentable: s.rentable,
    rentCalcPending: s.rentCalcPending,
    thresholdPct: s.thresholdPct,
  })) {
    expect(Number.isFinite(v), `${k} must be a finite number`).toBe(true);
  }

  // Ratios are percentages, not fractions (0.635 means 0.635%, not 63.5%).
  expect(s.medianRatioPct).toBeGreaterThan(0);
  expect(s.medianRatioPct).toBeLessThan(100);
  expect(s.thresholdPct).toBeGreaterThan(0);
  expect(s.thresholdPct).toBeLessThan(100);

  // Histogram: contiguous, ascending, non-negative, and no wider than the population.
  expect(s.histogram.length).toBeGreaterThan(0);
  let prevHi: number | null = null;
  for (const bin of s.histogram) {
    expect(bin.hiPct).toBeGreaterThan(bin.loPct);
    expect(bin.count).toBeGreaterThanOrEqual(0);
    if (prevHi !== null) {
      expect(bin.loPct, 'histogram bins must be contiguous').toBeCloseTo(prevHi, 6);
    }
    prevHi = bin.hiPct;
  }
  const binSum = s.histogram.reduce((a, b) => a + b.count, 0);
  expect(binSum).toBeLessThanOrEqual(s.total);
}

describe('/api/stats contract (pre-refactor baseline)', () => {
  it('the captured prod fixture satisfies every hero invariant', () => {
    assertStatsInvariants(baseline as StatsPayload);
  });

  it('records the shape the hero consumes', () => {
    // If a field is removed or renamed, the homepage breaks — fail loudly here.
    for (const field of [
      'total',
      'onePercentPasses',
      'medianRatioPct',
      'markets',
      'rentable',
      'rentCalcPending',
      'thresholdPct',
      'strategy',
      'histogram',
    ]) {
      expect(baseline, `hero field '${field}' missing`).toHaveProperty(field);
    }
  });

  it('median rent is served alongside (currently a second endpoint)', () => {
    expect(baseline.medianRent).toBeGreaterThan(0);
  });

  it('histogram bins sum to the rentable/scored population, not the whole table', () => {
    const binSum = baseline.histogram.reduce((a, b) => a + b.count, 0);
    // 461,925 scored vs 509,848 total — listings without a ratio are excluded.
    expect(binSum).toBeLessThan(baseline.total);
    expect(binSum).toBeGreaterThan(baseline.total * 0.5);
  });
});
