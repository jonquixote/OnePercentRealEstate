import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { parseQuery, numericParam, apiError } from './api-utils';

const Bounds = z.object({
  min_lat: numericParam(-90, 90),
  max_lat: numericParam(-90, 90),
  min_lon: numericParam(-180, 180),
  max_lon: numericParam(-180, 180),
  zoom: numericParam(0, 22),
});

function req(qs: string): Request {
  return new Request(`http://localhost/api/x?${qs}`);
}

describe('parseQuery — boundary validation', () => {
  it('returns ok with coerced numbers on valid bounds', () => {
    const r = parseQuery(
      Bounds,
      req('min_lat=37&max_lat=38&min_lon=-122&max_lon=-121&zoom=10'),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toEqual({
        min_lat: 37,
        max_lat: 38,
        min_lon: -122,
        max_lon: -121,
        zoom: 10,
      });
    }
  });

  it('returns a 400 (never 500) on non-numeric bounds', () => {
    const r = parseQuery(
      Bounds,
      req('min_lat=abc&max_lat=38&min_lon=-122&max_lon=-121&zoom=10'),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(400);
  });

  it('returns a 400 when bounds are out of range', () => {
    const r = parseQuery(
      Bounds,
      req('min_lat=999&max_lat=38&min_lon=-122&max_lon=-121&zoom=10'),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(400);
  });

  it('apiError uses the {error:{code,message}} envelope', () => {
    const res = apiError(400, 'invalid_query', 'bad');
    expect(res.status).toBe(400);
  });
});
