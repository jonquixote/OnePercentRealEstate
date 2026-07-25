import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * cachedSWR — stale-while-revalidate + single-flight.
 *
 * The homepage hero was slow not only because the aggregate is expensive
 * (18.5s) but because a plain TTL cache turns every expiry into a user-visible
 * stall, and N concurrent misses each ran the full query. These tests pin the
 * two behaviours that fix that:
 *   1. a stale value is served IMMEDIATELY while a refresh happens behind it
 *   2. concurrent misses collapse to exactly ONE loader call
 */

const store = new Map<string, string>();
const { mockGet, mockSet, mockDel } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockSet: vi.fn(),
  mockDel: vi.fn(),
}));

vi.mock('@/lib/redis', () => ({
  default: {
    get: (k: string) => mockGet(k),
    set: (...args: unknown[]) => mockSet(...args),
    del: (k: string) => mockDel(k),
    setex: vi.fn(),
    incr: vi.fn(),
  },
}));

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  mockGet.mockImplementation(async (k: string) => store.get(k) ?? null);
  // SET NX semantics: only the first caller wins the lock.
  mockSet.mockImplementation(async (k: string, v: string, ...rest: unknown[]) => {
    const nx = rest.includes('NX');
    if (nx && store.has(k)) return null;
    store.set(k, v);
    return 'OK';
  });
  mockDel.mockImplementation(async (k: string) => store.delete(k));
});

describe('cachedSWR', () => {
  it('fresh hit returns without calling the loader', async () => {
    const { cachedSWR } = await import('./cache-swr');
    store.set('swr:k1', JSON.stringify({ value: 'cached', computedAt: Date.now() }));
    const loader = vi.fn(async () => 'fresh');
    const out = await cachedSWR('k1', 60, 600, loader);
    expect(out).toBe('cached');
    expect(loader).not.toHaveBeenCalled();
  });

  it('stale hit returns the STALE value immediately and refreshes in background', async () => {
    const { cachedSWR } = await import('./cache-swr');
    // computed 10 minutes ago; ttl 60s => stale, but within staleTtl 3600s
    store.set('swr:k2', JSON.stringify({ value: 'old', computedAt: Date.now() - 600_000 }));
    let resolveLoader: (v: string) => void = () => {};
    const loader = vi.fn(() => new Promise<string>((r) => { resolveLoader = r; }));

    const out = await cachedSWR('k2', 60, 3600, loader);
    // Served instantly from stale — did NOT await the loader.
    expect(out).toBe('old');
    expect(loader).toHaveBeenCalledTimes(1);
    resolveLoader('new'); // let the background refresh finish
  });

  it('cold miss computes inline and stores the value', async () => {
    const { cachedSWR } = await import('./cache-swr');
    const loader = vi.fn(async () => 'computed');
    const out = await cachedSWR('k3', 60, 600, loader);
    expect(out).toBe('computed');
    expect(loader).toHaveBeenCalledTimes(1);
    expect(store.has('swr:k3')).toBe(true);
  });

  it('SINGLE-FLIGHT: concurrent cold misses call the loader exactly once', async () => {
    const { cachedSWR } = await import('./cache-swr');
    let calls = 0;
    const loader = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return `v${calls}`;
    };
    const results = await Promise.all([
      cachedSWR('k4', 60, 600, loader),
      cachedSWR('k4', 60, 600, loader),
      cachedSWR('k4', 60, 600, loader),
      cachedSWR('k4', 60, 600, loader),
    ]);
    expect(calls).toBe(1);
    // every caller gets the same value
    expect(new Set(results).size).toBe(1);
  });

  it('a loader error does NOT break callers when a stale value exists', async () => {
    const { cachedSWR } = await import('./cache-swr');
    store.set('swr:k5', JSON.stringify({ value: 'lastGood', computedAt: Date.now() - 600_000 }));
    const loader = vi.fn(async () => {
      throw new Error('db down');
    });
    const out = await cachedSWR('k5', 60, 3600, loader);
    expect(out).toBe('lastGood'); // stale served, error swallowed
  });

  it('propagates the error only when there is nothing to serve', async () => {
    const { cachedSWR } = await import('./cache-swr');
    const loader = vi.fn(async () => {
      throw new Error('db down');
    });
    await expect(cachedSWR('k6', 60, 600, loader)).rejects.toThrow('db down');
  });
});
