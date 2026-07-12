import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

function req(qs: string): NextRequest {
  return new NextRequest(`http://localhost/api/search/suggest?${qs}`);
}

describe('GET /api/search/suggest', () => {
  it('returns an empty list when q is absent', async () => {
    const res = await GET(req(''));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ suggestions: [] });
  });

  it('returns an empty list when q is only whitespace', async () => {
    const res = await GET(req('q=%20%20%20'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ suggestions: [] });
  });

  it('returns matching state suggestions for a full name prefix', async () => {
    const res = await GET(req('q=texas'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.suggestions).toContainEqual({ label: 'Texas', type: 'state', context: 'TX' });
  });

  it('returns zip suggestions for a numeric prefix', async () => {
    const res = await GET(req('q=1000'));
    const body = await res.json();
    expect(body.suggestions.length).toBeGreaterThan(0);
    expect(body.suggestions.every((s: any) => s.type === 'zip')).toBe(true);
    expect(body.suggestions.every((s: any) => s.label.startsWith('1000'))).toBe(true);
  });

  it('defaults the limit to 8 when not provided', async () => {
    const res = await GET(req('q=san'));
    const body = await res.json();
    expect(body.suggestions.length).toBeLessThanOrEqual(8);
  });

  it('honors an explicit limit', async () => {
    const res = await GET(req('q=san&limit=2'));
    const body = await res.json();
    expect(body.suggestions.length).toBeLessThanOrEqual(2);
  });

  it('returns 400 when limit is out of the [1, 20] range', async () => {
    const res = await GET(req('q=texas&limit=50'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_query');
  });

  it('returns 400 when limit is not numeric', async () => {
    const res = await GET(req('q=texas&limit=abc'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when q exceeds the 100-char cap', async () => {
    const longQ = 'a'.repeat(101);
    const res = await GET(req(`q=${longQ}`));
    expect(res.status).toBe(400);
  });

  it('accepts q at exactly the 100-char cap', async () => {
    const longQ = 'a'.repeat(100);
    const res = await GET(req(`q=${longQ}`));
    expect(res.status).toBe(200);
  });
});