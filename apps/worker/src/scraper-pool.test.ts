import { describe, it, expect } from 'vitest';
import { ScraperEndpoint, ScraperPool, type AimdConfig } from './scraper-pool';

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
  it('cooloffUntil reflects the block cool-off deadline', () => {
    const e = new ScraperEndpoint('http://a', CFG, () => 0);
    expect(e.cooloffUntil).toBe(0); // fresh endpoint, never blocked
    e.settle('blocked', 1000);
    expect(e.cooloffUntil).toBe(1000 + 30 * 60_000);
  });
  it("settle('error') counts the outcome but leaves rate and readiness untouched", () => {
    const e = new ScraperEndpoint('http://a', CFG, () => 1000);
    const intervalBefore = e.intervalMs;
    const readyAtBefore = e.readyAt();
    e.settle('error', 1000);
    expect(e.stats.error).toBe(1);
    expect(e.intervalMs).toBe(intervalBefore); // transient issue must not change the IP's rate
    expect(e.readyAt()).toBe(readyAtBefore);
  });
});

import { ScraperPool } from './scraper-pool';

describe('ScraperPool', () => {
  it('acquire returns an available endpoint and reserves it', () => {
    const p = new ScraperPool(['http://a', 'http://b'], CFG, () => 1000);
    const e = p.acquire(1000)!;
    expect(e).not.toBeNull();
    expect(e.available(1000)).toBe(false); // reserved
    // second acquire gets the OTHER endpoint (a is reserved)
    const e2 = p.acquire(1000)!;
    expect(e2.url).not.toBe(e.url);
  });
  it('returns null when every endpoint is reserved/cooling', () => {
    const p = new ScraperPool(['http://a'], CFG, () => 1000);
    p.acquire(1000);
    expect(p.acquire(1000)).toBeNull();
    expect(p.nextReadyAt()).toBe(31_000);
  });
  it('a blocked endpoint is skipped; a healthy one still serves', () => {
    const p = new ScraperPool(['http://a', 'http://b'], CFG, () => 1000);
    p.endpoints[0].settle('blocked', 1000);      // a cools off
    const e = p.acquire(1000)!;
    expect(e.url).toBe('http://b');               // b still available
  });
});

// ---------------------------------------------------------------------------
// Fail-away: a dead endpoint must leave rotation.
//
// 2026-07-24: the pool's only endpoint was unreachable. `settle('error')`
// deliberately leaves pacing untouched (transient network blip), so the worker
// retried it at full rate forever — 290 consecutive errors, 0 ok, ~10h of zero
// listings. Sustained errors must now sideline the endpoint so a healthy one
// takes the traffic; but the pool must never sideline ITSELF into doing nothing.
// ---------------------------------------------------------------------------
const FAILAWAY: AimdConfig = { ...CFG, failawayStreak: 3, failawayCooloffMs: 60_000 };

describe('ScraperEndpoint fail-away', () => {
  it('sidelines after N consecutive errors', () => {
    const e = new ScraperEndpoint('http://dead', FAILAWAY, () => 0);
    e.settle('error', 1000);
    e.settle('error', 1000);
    expect(e.isSidelined(1000)).toBe(false); // streak not reached yet
    e.settle('error', 1000);
    expect(e.isSidelined(1000)).toBe(true);
    expect(e.available(1000)).toBe(false);
  });

  it('recovers after the sideline cool-off expires', () => {
    const e = new ScraperEndpoint('http://dead', FAILAWAY, () => 0);
    for (let i = 0; i < 3; i++) e.settle('error', 1000);
    expect(e.isSidelined(1000)).toBe(true);
    expect(e.isSidelined(61_001)).toBe(false); // cool-off elapsed
  });

  it('a single success clears the error streak', () => {
    const e = new ScraperEndpoint('http://flaky', FAILAWAY, () => 0);
    e.settle('error', 1000);
    e.settle('error', 1000);
    e.settle('ok', 1000);
    e.settle('error', 1000);
    e.settle('error', 1000);
    expect(e.isSidelined(1000)).toBe(false); // streak restarted after the ok
  });
});

describe('ScraperPool fail-away routing', () => {
  it('routes all traffic to the healthy endpoint once the dead one sidelines', () => {
    const pool = new ScraperPool(['http://dead', 'http://good'], FAILAWAY, () => 0);
    const dead = pool.endpoints[0];
    for (let i = 0; i < 3; i++) dead.settle('error', 0);
    // Both are otherwise available at t=0; the sidelined one must not be picked.
    const picked = pool.acquire(0);
    expect(picked?.url).toBe('http://good');
  });

  it('NEVER returns null purely because every endpoint is sidelined', () => {
    // A single-endpoint pool that sidelines itself would stop the crawl
    // entirely — worse than retrying slowly. Sidelining is a preference,
    // not a hard stop.
    const pool = new ScraperPool(['http://only'], FAILAWAY, () => 0);
    for (let i = 0; i < 3; i++) pool.endpoints[0].settle('error', 0);
    expect(pool.endpoints[0].isSidelined(0)).toBe(true);
    const picked = pool.acquire(0);
    expect(picked?.url).toBe('http://only');
  });

  it('reports which endpoints are sidelined (for the degraded-pool log)', () => {
    const pool = new ScraperPool(['http://dead', 'http://good'], FAILAWAY, () => 0);
    for (let i = 0; i < 3; i++) pool.endpoints[0].settle('error', 0);
    expect(pool.sidelined(0).map((e) => e.url)).toEqual(['http://dead']);
  });
});
