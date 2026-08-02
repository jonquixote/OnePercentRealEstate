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

describe('GET — single-metro only', () => {
  // The `?all=1` batch mode was removed: the metro tour is now rendered
  // server-side by the hero via getSpotlightTour (see lib/spotlight.test.ts,
  // which covers the fan-out and startIndex logic). This route is only the
  // ZIP-pinning path now, so `?all=1` must behave like any other request —
  // a single entry — rather than silently returning a batch again.
  it('returns ONE entry, never a batch, even when ?all=1 is passed', async () => {
    const { GET } = await import('./route');
    const req = new NextRequest('http://x/api/spotlight?all=1');
    const body = await (await GET(req)).json();
    expect(body.metros).toBeUndefined();
    expect(body.metro).toBeTruthy();
    expect('deal' in body).toBe(true);
  });

  it('resolves a pinned ZIP to its metro', async () => {
    const { GET } = await import('./route');
    const req = new NextRequest('http://x/api/spotlight?zip=77002');
    const body = await (await GET(req)).json();
    expect(body.metro.zip).toBe('77002');
  });
});
