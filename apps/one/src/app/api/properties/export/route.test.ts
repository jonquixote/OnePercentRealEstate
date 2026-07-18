import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Issue #54: /api/properties/export mirrors the query route — opt into sold
 * rows via EITHER a body `includeSold: true` flag OR `?include_sold=1`. Export
 * is pro-gated; the session is stubbed pro. csvColumns/query-lang/primitives/
 * tracing/db/auth are stubbed so only the WHERE-shaping logic is exercised.
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
vi.mock('@/lib/csvColumns', () => ({
  resolveExportColumns: () => [
    { id: 'id', def: { header: 'id', value: (r: Record<string, unknown>) => String(r.id ?? '') } },
  ],
  csvEscape: (v: unknown) => String(v),
}));

import { POST } from './route';

function exportReq(qs: string, body: unknown): NextRequest {
  return new NextRequest(`http://x/api/properties/export${qs}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function mainSql(): string {
  const sql = h.sqls.find((s) => s.includes('FROM listings'));
  expect(sql).toBeDefined();
  return sql as string;
}

describe('POST /api/properties/export — includeSold dual acceptance (#54)', () => {
  beforeEach(() => {
    h.sqls.length = 0;
    h.client.query.mockClear();
    h.session.tier = 'pro';
  });

  it('402 for a non-pro session (gate intact)', async () => {
    h.session.tier = 'free';
    const res = await POST(exportReq('?include_sold=1', { expression: 'price > 100000' }));
    expect(res.status).toBe(402);
  });

  it('hides sold by default', async () => {
    const res = await POST(exportReq('', { expression: 'price > 100000' }));
    expect(res.status).toBe(200);
    expect(mainSql()).toMatch(/listing_status NOT IN \('sold','stale','rental_misfiled'\)/);
  });

  it('opts into sold via ?include_sold=1 (no body flag)', async () => {
    const res = await POST(exportReq('?include_sold=1', { expression: 'price > 100000' }));
    expect(res.status).toBe(200);
    const sql = mainSql();
    expect(sql).toMatch(/listing_status NOT IN \('stale','rental_misfiled'\)/);
    expect(sql).not.toMatch(/'sold'/);
  });

  it('opts into sold via body includeSold:true (param parity)', async () => {
    const res = await POST(exportReq('', { expression: 'price > 100000', includeSold: true }));
    expect(res.status).toBe(200);
    expect(mainSql()).toMatch(/listing_status NOT IN \('stale','rental_misfiled'\)/);
  });
});
