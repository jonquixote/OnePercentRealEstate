import { describe, it, expect, beforeEach, vi } from 'vitest';

type Row = Record<string, unknown>;
const query = vi.fn(async (_sql?: string, _params?: unknown[]): Promise<{ rows: Row[] }> => ({ rows: [] }));
vi.mock('@/lib/db', () => ({ default: { query: (...a: unknown[]) => query(...(a as [])) } }));

import { trackRoute, __resetPerfTracking } from './perf-track';
import { flushRouteLatency, readTrailingWindow } from './perf-flush';

beforeEach(() => { __resetPerfTracking(); query.mockClear(); query.mockResolvedValue({ rows: [] }); });

describe('flushRouteLatency', () => {
  it('writes nothing when there is no traffic', async () => {
    expect(await flushRouteLatency()).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('writes ONE aggregated row per route, not one per request', async () => {
    for (let i = 0; i < 200; i++) trackRoute('/api/stats', 10);
    for (let i = 0; i < 50; i++) trackRoute('/market/[zip]', 900);
    expect(await flushRouteLatency()).toBe(2);
    expect(query).toHaveBeenCalledTimes(1); // single multi-row insert
    const params = query.mock.calls[0]?.[1] ?? [];
    expect(params).toContain('/api/stats');
    expect(params).toContain('/market/[zip]');
  });

  it('never throws when the database is down', async () => {
    trackRoute('/api/stats', 10);
    query.mockRejectedValueOnce(new Error('db down'));
    await expect(flushRouteLatency()).resolves.toBe(0);
  });
});

describe('readTrailingWindow', () => {
  it('returns [] rather than throwing when the table is missing', async () => {
    query.mockRejectedValueOnce(Object.assign(new Error('no table'), { code: '42P01' }));
    expect(await readTrailingWindow(60)).toEqual([]);
  });

  it('maps rows to the same shape the live snapshot uses', async () => {
    query.mockResolvedValueOnce({ rows: [
      { route: '/market/[zip]', p50_ms: 100, p95_ms: 900, p99_ms: 1200, max_ms: 1500, count: 50 },
    ] });
    const [row] = await readTrailingWindow(60);
    expect(row).toMatchObject({ route: '/market/[zip]', p50: 100, p95: 900, p99: 1200, max: 1500, count: 50 });
  });
});
