import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db', () => ({
  default: { query },
}));

const sessionUser = { id: 'u1', email: 'a@b.com', tier: 'pro' as const };
vi.mock('@/lib/auth', () => ({
  getSessionUser: vi.fn(async () => sessionUser),
}));

import { GET, POST } from './route';

const row = {
  id: 7,
  source: 'area',
  source_label: 'Houston (77002)',
  ratio: '0.012',
  price: '185000',
  created_at: new Date().toISOString(),
  read_at: null,
  address: '123 Main St',
  primary_photo: 'p.jpg',
  property_url: 'https://x/1',
  city: 'Houston',
  state: 'TX',
  zip_code: '77002',
};

describe('GET /api/alerts', () => {
  beforeEach(() => query.mockReset());

  it('returns newest alerts + unread count', async () => {
    query
      .mockResolvedValueOnce({ rows: [row] }) // inbox
      .mockResolvedValueOnce({ rows: [{ unread: 3 }] }); // unread
    const res = await GET();
    const body = await res.json();
    expect(body.alerts).toHaveLength(1);
    expect(body.alerts[0].address).toBe('123 Main St');
    expect(body.unread).toBe(3);
    expect(query.mock.calls[0][1]).toEqual(['u1']);
  });

  it('401s when there is no session', async () => {
    const { getSessionUser } = await import('@/lib/auth');
    vi.mocked(getSessionUser).mockResolvedValueOnce(null as any);
    const res = await GET();
    expect(res.status).toBe(401);
    vi.mocked(getSessionUser).mockResolvedValue(sessionUser as any);
  });
});

describe('POST /api/alerts', () => {
  beforeEach(() => query.mockReset());

  it('marks only the session user ids read', async () => {
    query.mockResolvedValueOnce({ rowCount: 2 });
    const req = new NextRequest('http://x/api/alerts', {
      method: 'POST',
      body: JSON.stringify({ ids: [7, 9] }),
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.updated).toBe(2);
    // WHERE user_id = $1 AND id = ANY($2)
    expect(query.mock.calls[0][1]).toEqual(['u1', [7, 9]]);
  });

  it('never marks a row for a user who is not the session owner', async () => {
    query.mockResolvedValueOnce({ rowCount: 0 });
    const req = new NextRequest('http://x/api/alerts', {
      method: 'POST',
      body: JSON.stringify({ ids: [42] }),
    });
    await POST(req);
    // user_id must always be the session id, never overridden by the payload
    expect(query.mock.calls[0][1][0]).toBe('u1');
  });

  it('401s when there is no session', async () => {
    const { getSessionUser } = await import('@/lib/auth');
    vi.mocked(getSessionUser).mockResolvedValueOnce(null as any);
    const req = new NextRequest('http://x/api/alerts', {
      method: 'POST',
      body: JSON.stringify({ ids: [7] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    vi.mocked(getSessionUser).mockResolvedValue(sessionUser as any);
  });
});
