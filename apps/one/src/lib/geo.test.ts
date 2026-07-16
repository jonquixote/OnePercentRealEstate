import { describe, it, expect } from 'vitest';
import { metroFromHeaders } from './geo';

const H = (o: Record<string, string>) => new Headers(o);

describe('metroFromHeaders', () => {
  it('uses vercel lat/long to pick the nearest metro', () => {
    const m = metroFromHeaders(H({ 'x-vercel-ip-latitude': '29.75', 'x-vercel-ip-longitude': '-95.36' }));
    expect(m.label).toBe('Houston');
  });
  it('falls back to the default metro when no geo headers', () => {
    expect(metroFromHeaders(H({})).zip).toMatch(/^\d{5}$/);
  });
});
