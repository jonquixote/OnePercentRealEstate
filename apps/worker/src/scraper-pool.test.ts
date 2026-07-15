import { describe, it, expect } from 'vitest';
import { ScraperEndpoint, type AimdConfig } from './scraper-pool';

const CFG: AimdConfig = {
  minIntervalMs: 5_000, maxIntervalMs: 120_000, startIntervalMs: 30_000,
  decreaseMs: 1_000, increaseFactor: 2, cooloffMs: 30 * 60_000,
  cooloffMaxMs: 4 * 60 * 60_000, jitterFrac: 0, // jitter 0 for deterministic tests
};

describe('ScraperEndpoint AIMD', () => {
  it('starts at the configured interval and is available immediately', () => {
    const e = new ScraperEndpoint('http://a', CFG, () => 1000);
    expect(e.intervalMs).toBe(30_000);
    expect(e.available(1000)).toBe(true);
  });
  it('reserve() pushes the next start out by the interval', () => {
    const e = new ScraperEndpoint('http://a', CFG, () => 1000);
    e.reserve(1000);
    expect(e.available(1000)).toBe(false);
    expect(e.readyAt()).toBe(31_000);
    expect(e.available(31_000)).toBe(true);
  });
  it('additively decreases interval on success (toward min)', () => {
    const e = new ScraperEndpoint('http://a', CFG, () => 1000);
    e.settle('ok', 1000);
    expect(e.intervalMs).toBe(29_000); // -decreaseMs
    expect(e.stats.ok).toBe(1);
  });
  it('multiplicatively increases interval + enters cool-off on block', () => {
    const e = new ScraperEndpoint('http://a', CFG, () => 1000);
    e.settle('blocked', 1000);
    expect(e.intervalMs).toBe(60_000);        // ×increaseFactor
    expect(e.available(1000)).toBe(false);     // in cool-off
    expect(e.available(1000 + 30 * 60_000)).toBe(true);
    expect(e.stats.blocked).toBe(1);
  });
  it('never drops below min or rises above max', () => {
    const e = new ScraperEndpoint('http://a', { ...CFG, startIntervalMs: 6_000 }, () => 0);
    for (let i = 0; i < 10; i++) e.settle('ok', 0);
    expect(e.intervalMs).toBe(CFG.minIntervalMs);
    for (let i = 0; i < 10; i++) e.settle('blocked', 0);
    expect(e.intervalMs).toBe(CFG.maxIntervalMs);
  });
  it('repeated blocks escalate the cool-off up to the cap', () => {
    const e = new ScraperEndpoint('http://a', CFG, () => 0);
    e.settle('blocked', 0);
    const first = e.readyAt();
    e.settle('blocked', first);       // second block after the first window
    expect(e.readyAt() - first).toBeGreaterThan(30 * 60_000); // escalated
  });
});
