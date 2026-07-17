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
  it('prefers x-geo-* (nginx) over x-vercel-*', () => {
    const m = metroFromHeaders(H({
      'x-geo-latitude': '41.49', 'x-geo-longitude': '-81.69',            // Cleveland
      'x-vercel-ip-latitude': '29.75', 'x-vercel-ip-longitude': '-95.36', // Houston
    }));
    expect(m.label).toBe('Cleveland');
  });
  it('empty x-geo values fall through to x-vercel', () => {
    const m = metroFromHeaders(H({
      'x-geo-latitude': '', 'x-geo-longitude': '',
      'x-vercel-ip-latitude': '29.75', 'x-vercel-ip-longitude': '-95.36',
    }));
    expect(m.label).toBe('Houston');
  });
  it('no geo headers at all (empty x-geo) falls back to default metro', () => {
    const m = metroFromHeaders(H({ 'x-geo-latitude': '', 'x-geo-longitude': '' }));
    expect(m.zip).toBe('77002'); // DEFAULT_METRO (Houston)
  });
});
