import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/db', () => ({
  default: {
    query: vi.fn(async () => ({
      rows: [
        {
          id: 'x',
          address: 'a',
          listing_price: 190000,
          estimated_rent: 2200,
          rent_low: 2000,
          rent_high: 2400,
          primary_photo: 'p.jpg',
          zip_code: '90004',
        },
      ],
    })),
  },
}));

import { resolveLoc } from './route';

describe('resolveLoc', () => {
  it('prefers an explicit valid ?zip= over geo', () => {
    const sp = new URLSearchParams({ zip: '90004' });
    const { metro } = resolveLoc(sp, new Headers({ 'x-vercel-ip-latitude': '29.7', 'x-vercel-ip-longitude': '-95.3' }));
    expect(metro.label).toBe('Los Angeles');
  });
  it('ignores a malformed zip and falls back to geo', () => {
    const sp = new URLSearchParams({ zip: 'abcde' });
    const { metro } = resolveLoc(sp, new Headers({ 'x-vercel-ip-latitude': '29.75', 'x-vercel-ip-longitude': '-95.36' }));
    expect(metro.label).toBe('Houston');
  });
});

describe('GET ?all=1', () => {
  it('returns one entry per canonical metro, in METROS order', async () => {
    const { GET } = await import('./route');
    const { METROS } = await import('@/lib/metros');
    const req = new NextRequest('http://x/api/spotlight?all=1');
    const res = await GET(req);
    const body = await res.json();
    expect(Array.isArray(body.metros)).toBe(true);
    expect(body.metros).toHaveLength(METROS.length);
    expect(body.metros.map((m: { metro: { zip: string } }) => m.metro.zip)).toEqual(
      METROS.map((m) => m.zip),
    );
    for (const entry of body.metros) {
      expect(entry.metro.label).toBeTruthy();
      expect('deal' in entry).toBe(true);
    }
  });
});
