import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Issue #54: /api/properties/query must opt into sold rows via EITHER a body
 * `includeSold: true` flag OR a `?include_sold=1` query param. These tests
 * assert the generated lifecycle filter for each caller shape. query-lang,
 * primitives, tracing, db, and auth are stubbed so the test exercises only the
 * route's WHERE-shaping logic (the SQL is never executed).
 */

const h = vi.hoisted(() => {
  const sqls: string[] = [];
  const client = {
    query: vi.fn(async (sql: string) => {
      sqls.push(String(sql));
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  return {
    sqls,
    client,
    pool: { connect: vi.fn(async () => client), query: vi.fn() },
    session: { tier: 'pro' as string | null },
  };
});

vi.mock('@/lib/db', () => ({ default: h.pool }));
vi.mock('@/lib/auth', () => ({
  getSessionUser: vi.fn(async () =>
    h.session.tier ? { id: 'u1', email: 'a@b.co', tier: h.session.tier } : null,
  ),
}));
vi.mock('@/lib/tracing', () => ({
  withSpan: async (_name: string, fn: () => unknown) => fn(),
}));
vi.mock('@oper/query-lang', () => ({
  parse: (s: string) => ({ expr: s }),
  compile: () => ({ whereSql: 'price > $1', params: [100000], usedColumns: ['price'] }),
  ALLOWED_COLUMNS_LIST: ['price'],
}));
vi.mock('@oper/primitives', () => ({ MOTIVATED_SELLER_SCORE_SQL: '0' }));

import { POST } from './route';

function queryReq(qs: string, body: unknown): NextRequest {
  return new NextRequest(`http://x/api/properties/query${qs}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function mainSql(): string {
  const sql = h.sqls.find((s) => s.includes('FROM listings'));
  expect(sql).toBeDefined();
  return sql as string;
}

describe('POST /api/properties/query — includeSold dual acceptance (#54)', () => {
  beforeEach(() => {
    h.sqls.length = 0;
    h.client.query.mockClear();
    h.session.tier = 'pro';
  });

  it('hides sold by default (no body flag, no param)', async () => {
    const res = await POST(queryReq('', { expression: 'price > 100000' }));
    expect(res.status).toBe(200);
    expect(mainSql()).toMatch(/listing_status NOT IN \('sold','stale','rental_misfiled'\)/);
  });

  it('opts into sold via ?include_sold=1 (no body flag)', async () => {
    const res = await POST(queryReq('?include_sold=1', { expression: 'price > 100000' }));
    expect(res.status).toBe(200);
    const sql = mainSql();
    expect(sql).toMatch(/listing_status NOT IN \('stale','rental_misfiled'\)/);
    expect(sql).not.toMatch(/'sold'/);
  });

  it('opts into sold via body includeSold:true (param parity)', async () => {
    const res = await POST(queryReq('', { expression: 'price > 100000', includeSold: true }));
    expect(res.status).toBe(200);
    expect(mainSql()).toMatch(/listing_status NOT IN \('stale','rental_misfiled'\)/);
  });

  it('ignores include_sold values other than "1"', async () => {
    await POST(queryReq('?include_sold=true', { expression: 'price > 100000' }));
    expect(mainSql()).toMatch(/listing_status NOT IN \('sold','stale','rental_misfiled'\)/);
  });
});
