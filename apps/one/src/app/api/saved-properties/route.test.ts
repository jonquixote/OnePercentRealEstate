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

import { POST } from './route';

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://x/api/saved-properties', {
    method: 'POST',
    body: JSON.stringify(body),
  });
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
