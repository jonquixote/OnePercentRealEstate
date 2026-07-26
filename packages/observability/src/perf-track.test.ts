import { describe, it, expect, beforeEach } from 'vitest';
import { trackRoute, snapshot, percentiles, __resetPerfTracking } from './perf-track.js';

/**
 * The tracker's job is to make slowness visible WITHOUT becoming a load problem
 * itself — the postgres-exporter already taught us that lesson at 79% of DB
 * time. These tests pin the bounds, not just the maths.
 */
beforeEach(() => __resetPerfTracking());

describe('percentiles', () => {
  it('computes nearest-rank percentiles', () => {
    const p = percentiles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(p.p50).toBe(5);
    expect(p.p95).toBe(10);
    expect(p.max).toBe(10);
  });
  it('handles a single sample and empty input', () => {
    expect(percentiles([42]).p95).toBe(42);
    expect(percentiles([]).p95).toBe(0);
  });
});

describe('trackRoute bounds', () => {
  it('never grows past the per-route sample cap', () => {
    for (let i = 0; i < 10_000; i++) trackRoute('/x', i);
    const s = snapshot().find((r) => r.route === '/x')!;
    expect(s.count).toBeLessThanOrEqual(500);   // ring is fixed-size
    expect(s.observed).toBe(10_000);            // but we still count everything
  });

  it('caps distinct routes so a route explosion cannot leak memory', () => {
    for (let i = 0; i < 500; i++) trackRoute(`/route-${i}`, 10);
    expect(snapshot().length).toBeLessThanOrEqual(64);
  });

  it('ignores garbage instead of throwing', () => {
    expect(() => {
      trackRoute('/x', Number.NaN);
      trackRoute('/x', -5);
      trackRoute('/x', Infinity);
    }).not.toThrow();
    expect(snapshot().find((r) => r.route === '/x')).toBeUndefined();
  });

  it('surfaces the slowest routes first', () => {
    for (let i = 0; i < 20; i++) { trackRoute('/fast', 5); trackRoute('/slow', 900); }
    expect(snapshot()[0].route).toBe('/slow');
  });

  it('reports a realistic p95 for a skewed distribution', () => {
    // 10% tail: with exactly 5% the nearest-rank p95 sits ON the boundary and
    // correctly returns the fast value — a subtlety worth encoding explicitly.
    for (let i = 0; i < 90; i++) trackRoute('/api/stats', 8);
    for (let i = 0; i < 10; i++) trackRoute('/api/stats', 4000); // the cold-path tail
    const s = snapshot().find((r) => r.route === '/api/stats')!;
    expect(s.p50).toBe(8);
    expect(s.p95).toBeGreaterThan(1000); // the tail is what users actually feel
  });
});
