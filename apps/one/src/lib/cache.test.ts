import { describe, it, expect, vi, beforeEach } from 'vitest';

const { redisMock } = vi.hoisted(() => ({
  redisMock: {
    get: vi.fn(),
    set: vi.fn(),
    incr: vi.fn(),
  },
}));

vi.mock('@/lib/redis', () => ({
  default: redisMock,
}));

import { cached, getCacheVersion, bumpCacheVersion, CACHE_TTL, CACHE_VERSION_KEY } from './cache';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CACHE_TTL', () => {
  it('exposes the documented TTL taxonomy', () => {
    expect(CACHE_TTL).toEqual({ listing: 60, stats: 300, hud: 86400 });
  });
});

describe('getCacheVersion', () => {
  it('returns the existing version without writing', async () => {
    redisMock.get.mockResolvedValue('5');
    const v = await getCacheVersion();
    expect(v).toBe('5');
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it('initializes the version to "1" when unset', async () => {
    redisMock.get.mockResolvedValue(null);
    redisMock.set.mockResolvedValue('OK');
    const v = await getCacheVersion();
    expect(v).toBe('1');
    expect(redisMock.set).toHaveBeenCalledWith(CACHE_VERSION_KEY, '1');
  });

  it('degrades to "0" on redis read failure (never throws)', async () => {
    redisMock.get.mockRejectedValue(new Error('connection refused'));
    const v = await getCacheVersion();
    expect(v).toBe('0');
  });
});

describe('bumpCacheVersion', () => {
  it('increments the shared version key', async () => {
    redisMock.incr.mockResolvedValue(2);
    await bumpCacheVersion();
    expect(redisMock.incr).toHaveBeenCalledWith(CACHE_VERSION_KEY);
  });

  it('swallows redis errors instead of throwing', async () => {
    redisMock.incr.mockRejectedValue(new Error('connection refused'));
    await expect(bumpCacheVersion()).resolves.toBeUndefined();
  });
});

describe('cached', () => {
  it('returns a parsed cache hit without invoking fn', async () => {
    redisMock.get.mockImplementation(async (key: string) => {
      if (key === CACHE_VERSION_KEY) return '3';
      if (key === 'v3:mykey') return JSON.stringify({ foo: 'bar' });
      return null;
    });
    const fn = vi.fn();

    const result = await cached('mykey', 60, fn);

    expect(result).toEqual({ foo: 'bar' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('calls fn and writes through on a cache miss', async () => {
    redisMock.get.mockImplementation(async (key: string) =>
      key === CACHE_VERSION_KEY ? '2' : null,
    );
    redisMock.set.mockResolvedValue('OK');
    const fn = vi.fn().mockResolvedValue({ a: 1 });

    const result = await cached('mykey', 90, fn);

    expect(result).toEqual({ a: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(redisMock.set).toHaveBeenCalledWith('v2:mykey', JSON.stringify({ a: 1 }), 'EX', 90);
  });

  it('prefixes the cache key with the shared version', async () => {
    redisMock.get.mockImplementation(async (key: string) =>
      key === CACHE_VERSION_KEY ? '7' : null,
    );
    const fn = vi.fn().mockResolvedValue({ x: 1 });

    await cached('properties:p1', 60, fn);

    const readKeys = redisMock.get.mock.calls.map((c) => c[0]);
    expect(readKeys).toContain('v7:properties:p1');
  });

  it('does not write through when fn resolves null (no negative caching)', async () => {
    redisMock.get.mockImplementation(async (key: string) =>
      key === CACHE_VERSION_KEY ? '1' : null,
    );
    const fn = vi.fn().mockResolvedValue(null);

    const result = await cached('hud:99999', CACHE_TTL.hud, fn);

    expect(result).toBeNull();
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it('does not write through when fn resolves undefined', async () => {
    redisMock.get.mockImplementation(async (key: string) =>
      key === CACHE_VERSION_KEY ? '1' : null,
    );
    const fn = vi.fn().mockResolvedValue(undefined);

    const result = await cached('mykey', 60, fn);

    expect(result).toBeUndefined();
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it('falls back to calling fn when the redis read fails', async () => {
    redisMock.get.mockImplementation(async (key: string) => {
      if (key === CACHE_VERSION_KEY) return '1';
      throw new Error('read failed');
    });
    redisMock.set.mockResolvedValue('OK');
    const fn = vi.fn().mockResolvedValue({ ok: true });

    const result = await cached('mykey', 60, fn);

    expect(result).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('still returns the fresh value when the redis write fails', async () => {
    redisMock.get.mockImplementation(async (key: string) =>
      key === CACHE_VERSION_KEY ? '1' : null,
    );
    redisMock.set.mockRejectedValue(new Error('write failed'));
    const fn = vi.fn().mockResolvedValue({ ok: true });

    const result = await cached('mykey', 60, fn);

    expect(result).toEqual({ ok: true });
  });

  it('degrades to the "0" version prefix when the version lookup itself fails', async () => {
    redisMock.get.mockRejectedValue(new Error('down'));
    redisMock.set.mockResolvedValue('OK');
    const fn = vi.fn().mockResolvedValue({ ok: true });

    const result = await cached('mykey', 60, fn);

    expect(result).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(redisMock.set).toHaveBeenCalledWith('v0:mykey', JSON.stringify({ ok: true }), 'EX', 60);
  });
});