import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const query = vi.fn();
vi.mock('@/lib/db', () => ({ default: { query: (...a: unknown[]) => query(...(a as [])) } }));

beforeEach(() => {
  query.mockReset();
  query.mockResolvedValue({ rows: [] });
});

// The route keeps an in-memory TTL cache keyed by `${zip}:${series}` (see
// route.ts:55). Each test therefore uses a DISTINCT zip — otherwise a later
// test silently reads an earlier test's mocked rows, which is exactly what
// happened while writing these.
const call = async (qs: string) => {
  const { GET } = await import('./route');
  return GET(new NextRequest(`http://x/api/market-series${qs}`));
};

describe('GET /api/market-series', () => {
  it('400s on a missing zip rather than 500ing on it', async () => {
    const res = await call('');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid query');
  });

  it('400s on a malformed zip', async () => {
    expect((await call('?zip=abc')).status).toBe(400);
  });

  it('returns the series shape a chart can consume', async () => {
    query.mockResolvedValue({ rows: [{ year: 2024, hpi: 310.5 }] });
    const res = await call('?zip=77002&series=hpi');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.series.hpi).toEqual([{ t: 2024, v: 310.5 }]);
  });

  it('drops non-finite points instead of emitting NaN into a chart', async () => {
    query.mockResolvedValue({ rows: [
      { year: 2023, hpi: null },
      { year: 2024, hpi: 300 },
    ] });
    const body = await (await call('?zip=44102&series=hpi')).json();
    expect(body.series.hpi).toEqual([{ t: 2024, v: 300 }]);
  });

  it('serves a repeat request for the same zip from its in-memory cache', async () => {
    query.mockResolvedValue({ rows: [{ year: 2024, hpi: 111 }] });
    const first = await (await call('?zip=15201&series=hpi')).json();
    expect(first.series.hpi).toEqual([{ t: 2024, v: 111 }]);

    // Different underlying data; the cache should mean we never see it.
    query.mockResolvedValue({ rows: [{ year: 2024, hpi: 999 }] });
    const second = await (await call('?zip=15201&series=hpi')).json();
    expect(second.series.hpi).toEqual([{ t: 2024, v: 111 }]);
  });

  it('does not leak an unhandled rejection when the database is down', async () => {
    query.mockRejectedValue(new Error('db down'));
    await expect(call('?zip=63104&series=hpi')).resolves.toBeDefined();
  });
});
