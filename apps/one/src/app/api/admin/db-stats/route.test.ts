import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/* eslint-disable @typescript-eslint/no-explicit-any */

const fixtures = {
  topByTotalTime: [
    { query: 'SELECT * FROM listings WHERE id = $1', calls: 100, mean_exec_time: 2.5, total_exec_time: 250 },
    { query: 'SELECT count(*) FROM rental_listings', calls: 10, mean_exec_time: 50, total_exec_time: 500 },
  ],
  topByMeanTime: [
    { query: 'SELECT * FROM census_tracts', calls: 1, mean_exec_time: 120, total_exec_time: 120 },
  ],
  indexUsage: [
    {
      schemaname: 'public',
      relname: 'listings',
      indexrelname: 'idx_listings_lat_lon',
      idx_scan: 0,
      idx_blks_read: 15000,
      size_bytes: 150994944,
    },
  ],
};

const { query, release } = vi.hoisted(() => ({
  query: vi.fn(async (text: string): Promise<any> => {
    if (text.includes('pg_stat_user_indexes')) {
      return { rows: fixtures.indexUsage };
    }
    if (text.includes('pg_stat_statements') && text.includes('ORDER BY mean_exec_time')) {
      return { rows: fixtures.topByMeanTime };
    }
    if (text.includes('pg_stat_statements') && text.includes('ORDER BY total_exec_time')) {
      return { rows: fixtures.topByTotalTime };
    }
    return { rows: [], rowCount: 0 };
  }),
  release: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  default: {
    connect: vi.fn(async () => ({ query, release })),
  },
}));

const ADMIN_KEY = 'test-admin-key';

describe('GET /api/admin/db-stats', () => {
  beforeEach(() => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    query.mockClear();
  });

  afterEach(() => {
    delete process.env.ADMIN_API_KEY;
  });

  it('returns 401 without an admin key', async () => {
    const { GET } = await import('./route');
    const req = new NextRequest('http://x/api/admin/db-stats');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns 401 with the wrong admin key', async () => {
    const { GET } = await import('./route');
    const req = new NextRequest('http://x/api/admin/db-stats', {
      headers: { 'x-api-key': 'wrong-key' },
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns the expected shape with the admin key (mocked pool)', async () => {
    const { GET } = await import('./route');
    const req = new NextRequest('http://x/api/admin/db-stats', {
      headers: { 'x-api-key': ADMIN_KEY },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('topByTotalTime');
    expect(body).toHaveProperty('topByMeanTime');
    expect(body).toHaveProperty('indexUsage');
    expect(Array.isArray(body.topByTotalTime)).toBe(true);
    expect(Array.isArray(body.topByMeanTime)).toBe(true);
    expect(Array.isArray(body.indexUsage)).toBe(true);

    expect(body.topByTotalTime).toEqual(fixtures.topByTotalTime);
    expect(body.topByMeanTime).toEqual(fixtures.topByMeanTime);
    expect(body.indexUsage).toEqual(fixtures.indexUsage);

    const row = body.topByTotalTime[0];
    expect(row).toHaveProperty('query');
    expect(row).toHaveProperty('calls');
    expect(row).toHaveProperty('mean_exec_time');
    expect(row).toHaveProperty('total_exec_time');
  });

  it('does not issue any write statement (read-only)', async () => {
    const { GET } = await import('./route');
    const req = new NextRequest('http://x/api/admin/db-stats', {
      headers: { 'x-api-key': ADMIN_KEY },
    });
    await GET(req);
    const texts = query.mock.calls.map((c: unknown[]) => String(c[0]));
    const writes = texts.filter((t) =>
      /^\s*(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|GRANT|REVOKE|CREATE)\b/i.test(t),
    );
    expect(writes).toEqual([]);
  });
});
