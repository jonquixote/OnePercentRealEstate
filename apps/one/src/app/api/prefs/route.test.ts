import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { query, session } = vi.hoisted(() => ({
  query: vi.fn(async () => ({ rows: [{ prefs: {} }], rowCount: 1 })),
  session: { id: 'u1', email: 'a@b.co', tier: 'free' as const },
}));

vi.mock('@/lib/db', () => ({
  default: { query },
}));

vi.mock('@/lib/auth', () => ({
  getSessionUser: vi.fn(async () => (session.id === '' ? null : session)),
}));

import { GET, PUT } from './route';

function putReq(body: unknown): NextRequest {
  return new NextRequest('http://x/api/prefs', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

describe('GET /api/prefs', () => {
  beforeEach(() => {
    query.mockClear();
    query.mockResolvedValue({ rows: [{ prefs: {} }], rowCount: 1 });
  });

  it('401 without a session', async () => {
    session.id = '';
    const res = await GET();
    expect(res.status).toBe(401);
    session.id = 'u1';
  });

  it('returns parsed defaults when profile prefs empty', async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.financing.ratePct).toBe(6.5);
    expect(body.areas).toEqual([]);
  });
});

describe('PUT /api/prefs', () => {
  beforeEach(() => {
    query.mockClear();
    query.mockResolvedValue({ rows: [{ prefs: {} }], rowCount: 1 });
  });

  it('401 without a session', async () => {
    session.id = '';
    const res = await PUT(putReq({ financing: { ratePct: 99 } }));
    expect(res.status).toBe(401);
    session.id = 'u1';
  });

  it('writes the CLEANED object, not raw client json', async () => {
    const res = await PUT(putReq({ financing: { ratePct: 99 }, stray: 'x' }));
    expect(res.status).toBe(200);
    const written = JSON.parse(String((query.mock.calls[0] as unknown as unknown[][])?.[1]?.[0]));
    expect(written.financing.ratePct).toBe(15); // clamped
    expect((written as Record<string, unknown>).stray).toBeUndefined();
  });

  it('drops malformed areas on write', async () => {
    const res = await PUT(putReq({ areas: [{ label: 'Houston', zip: '77002' }, { label: 'Bad', zip: 'nope' }] }));
    expect(res.status).toBe(200);
    const written = JSON.parse(String((query.mock.calls[0] as unknown as unknown[][])?.[1]?.[0]));
    expect(written.areas).toHaveLength(1);
  });
});
