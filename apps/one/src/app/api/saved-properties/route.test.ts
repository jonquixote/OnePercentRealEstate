import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
interface QueryResultLike { rows: Row[]; rowCount: number | null }

const { query, session } = vi.hoisted(() => {
  const session = { id: 'u1', email: 'a@b.co', tier: 'free' as const };
  const query = vi.fn(async (): Promise<QueryResultLike> => ({ rows: [], rowCount: 0 }));
  return { query, session };
});

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

function delReq(id: string): NextRequest {
  return new NextRequest(`http://x/api/saved-properties?id=${id}`, { method: 'DELETE' });
}

function delReqListing(listingId: string): NextRequest {
  return new NextRequest(`http://x/api/saved-properties?listingId=${listingId}`, { method: 'DELETE' });
}

describe('POST /api/saved-properties', () => {
  beforeEach(() => {
    query.mockClear();
    query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('401 without a session', async () => {
    session.id = '';
    const res = await POST(postReq({ listingId: 5 }));
    expect(res.status).toBe(401);
    session.id = 'u1';
  });

  it('inserts once and returns 201', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 42 }], rowCount: 1 });
    const res = await POST(postReq({ listingId: 5 }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe(42);
    expect(body.created).toBe(true);
    expect((query.mock.calls[0] as unknown as unknown[][])[1]).toEqual(['u1', 5, null]);
  });

  it('second POST same listing is idempotent 200 with existing id', async () => {
    query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // INSERT ON CONFLICT DO NOTHING -> nothing
      .mockResolvedValueOnce({ rows: [{ id: 42 }], rowCount: 1 }); // SELECT existing
    const res = await POST(postReq({ listingId: 5 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(42);
    expect(body.created).toBe(false);
  });

  it('400 on missing listingId', async () => {
    const res = await POST(postReq({}));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/saved-properties', () => {
  beforeEach(() => {
    query.mockClear();
  });

  it('401 without a session', async () => {
    session.id = '';
    const res = await GET();
    expect(res.status).toBe(401);
    session.id = 'u1';
  });

  it('returns hydrated rows newest-first', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { save_id: 2, address: 'B', created_at: '2026-01-02' },
        { save_id: 1, address: 'A', created_at: '2026-01-01' },
      ],
      rowCount: 2,
    });
    const res = await GET();
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0].address).toBe('B');
    expect((query.mock.calls[0] as unknown as unknown[][])[1]).toEqual(['u1']);
  });

  it('falls back to status-less SELECT on 42703', async () => {
    query
      .mockRejectedValueOnce(Object.assign(new Error('col missing'), { code: '42703' }))
      .mockResolvedValueOnce({ rows: [{ save_id: 1, address: 'A' }], rowCount: 1 });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(query.mock.calls).toHaveLength(2);
  });
});

describe('DELETE /api/saved-properties', () => {
  beforeEach(() => {
    query.mockClear();
    query.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  it('401 without a session', async () => {
    session.id = '';
    const res = await DELETE(delReq('7'));
    expect(res.status).toBe(401);
    session.id = 'u1';
  });

  it('only deletes the session user row', async () => {
    const res = await DELETE(delReq('7'));
    expect(res.status).toBe(200);
    expect((query.mock.calls[0] as unknown as unknown[][])[1]).toEqual(['7', 'u1']);
  });

  it('400 on bad id', async () => {
    const res = await DELETE(delReq('abc'));
    expect(res.status).toBe(400);
  });

  it('deletes by listingId (SaveButton path)', async () => {
    const res = await DELETE(delReqListing('42'));
    expect(res.status).toBe(200);
    // listing_id bound first, user_id second — scoped to session.
    expect((query.mock.calls[0] as unknown as unknown[][])[1]).toEqual(['42', 'u1']);
    expect((query.mock.calls[0] as unknown as string[])[0]).toMatch(/listing_id/);
  });

  it('400 when neither id nor listingId given', async () => {
    const res = await DELETE(new NextRequest('http://x/api/saved-properties', { method: 'DELETE' }));
    expect(res.status).toBe(400);
  });
});
