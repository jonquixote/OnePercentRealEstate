import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { query, session } = vi.hoisted(() => ({
  query: vi.fn(async (): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> => ({
    rows: [],
    rowCount: 0,
  })),
  session: { id: 'u1', email: 'a@b.co', tier: 'free' as const },
}));

vi.mock('@/lib/db', () => ({
  default: { query },
}));

vi.mock('@/lib/auth', () => ({
  getSessionUser: vi.fn(async () => (session.id === '' ? null : session)),
}));

import { GET, POST, DELETE } from './route';

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://x/api/saved-properties', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function delReq(qs: string): NextRequest {
  return new NextRequest(`http://x/api/saved-properties${qs}`, { method: 'DELETE' });
}

describe('POST /api/saved-properties', () => {
  beforeEach(() => {
    query.mockClear();
    query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('401 without a session', async () => {
    session.id = '';
    const res = await POST(postReq({ listingId: '123' }));
    expect(res.status).toBe(401);
    session.id = 'u1';
  });

  it('400 when listingId missing', async () => {
    const res = await POST(postReq({}));
    expect(res.status).toBe(400);
  });

  it('400 when listingId is not a safe positive integer string', async () => {
    const res = await POST(postReq({ listingId: '9'.repeat(20) })); // 20 digits > 18
    expect(res.status).toBe(400);
  });

  it('passes string listingId into the INSERT params', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 5 }], rowCount: 1 });
    const res = await POST(postReq({ listingId: '999999999999999999' })); // 18 digits, safe
    expect(res.status).toBe(201);
    expect((query.mock.calls[0] as unknown as unknown[][])?.[1]).toEqual(['u1', '999999999999999999', null]);
  });

  it('accepts a safe-integer number listingId, stringified', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 6 }], rowCount: 1 });
    const res = await POST(postReq({ listingId: 42 }));
    expect(res.status).toBe(201);
    expect((query.mock.calls[0] as unknown as unknown[][])?.[1]?.[1]).toBe('42');
  });
});

describe('GET /api/saved-properties', () => {
  beforeEach(() => {
    query.mockClear();
    query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('401 without a session', async () => {
    session.id = '';
    const res = await GET();
    expect(res.status).toBe(401);
    session.id = 'u1';
  });

  it('returns hydrated rows scoped to the session user, newest-first', async () => {
    const rows = [
      { save_id: 9, id: '200', address: 'B', saved_at: '2026-02-01' },
      { save_id: 4, id: '100', address: 'A', saved_at: '2026-01-01' },
    ];
    query.mockResolvedValueOnce({ rows, rowCount: rows.length });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(rows);

    // Session-scoped: the only bound param is the session user's id.
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(params).toEqual(['u1']);
    expect(sql).toMatch(/WHERE sp\.user_id = \$1/);
    // Newest-first is a SQL guarantee, not a client sort.
    expect(sql).toMatch(/ORDER BY sp\.created_at DESC/);
    // The hydration JOINs the listing card.
    expect(sql).toMatch(/JOIN listings l ON l\.id = sp\.listing_id/);
  });

  it('falls back to the status-free SELECT when listing_status is absent (42703)', async () => {
    query
      .mockRejectedValueOnce(Object.assign(new Error('column does not exist'), { code: '42703' }))
      .mockResolvedValueOnce({ rows: [{ save_id: 1, id: '5' }], rowCount: 1 });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ save_id: 1, id: '5' }]);
    // Two attempts: WITH_STATUS (threw 42703) then WITHOUT_STATUS.
    expect(query).toHaveBeenCalledTimes(2);
    const secondSql = (query.mock.calls[1] as unknown as [string])[0];
    expect(secondSql).not.toMatch(/listing_status/);
  });

  it('500 when the query fails for a non-42703 reason', async () => {
    query.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: '08006' }));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/saved-properties', () => {
  beforeEach(() => {
    query.mockClear();
    query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('401 without a session', async () => {
    session.id = '';
    const res = await DELETE(delReq('?listingId=123'));
    expect(res.status).toBe(401);
    session.id = 'u1';
  });

  it('400 when neither id nor listingId is provided', async () => {
    const res = await DELETE(delReq(''));
    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('deletes by listingId, scoped to the session user', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await DELETE(delReq('?listingId=123'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 1 });
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/DELETE FROM saved_properties WHERE listing_id = \$1 AND user_id = \$2/);
    expect(params).toEqual(['123', 'u1']);
  });

  it('deletes by primary-key id, scoped to the session user', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await DELETE(delReq('?id=5'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 1 });
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/DELETE FROM saved_properties WHERE id = \$1 AND user_id = \$2/);
    expect(params).toEqual(['5', 'u1']);
  });

  it('prefers listingId when both are supplied', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await DELETE(delReq('?id=5&listingId=123'));
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/WHERE listing_id = \$1/);
    expect(params).toEqual(['123', 'u1']);
  });
});
