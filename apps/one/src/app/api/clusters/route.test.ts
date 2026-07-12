import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { poolMock, checkRateLimitMock } = vi.hoisted(() => ({
  poolMock: { query: vi.fn() },
  checkRateLimitMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ default: poolMock }));
vi.mock('@/lib/rate-limit', () => ({
  clustersLimiter: {},
  checkRateLimit: checkRateLimitMock,
}));

import { GET } from './route';

function req(qs: string, headers?: Record<string, string>): NextRequest {
  return new NextRequest(`http://localhost/api/clusters?${qs}`, { headers });
}

const validQs = 'min_lat=30&max_lat=31&min_lon=-98&max_lon=-97&zoom=10';

beforeEach(() => {
  vi.clearAllMocks();
  checkRateLimitMock.mockResolvedValue({ allowed: true });
});

describe('GET /api/clusters', () => {
  it('returns 400 when required bounds params are missing', async () => {
    const res = await GET(req('min_lat=30&max_lat=31'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_query');
    expect(poolMock.query).not.toHaveBeenCalled();
  });

  it('returns 400 when a bound is out of its valid range', async () => {
    const res = await GET(req('min_lat=999&max_lat=31&min_lon=-98&max_lon=-97&zoom=10'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when zoom is out of the [0, 22] range', async () => {
    const res = await GET(req('min_lat=30&max_lat=31&min_lon=-98&max_lon=-97&zoom=30'));
    expect(res.status).toBe(400);
  });

  it('returns 429 with a Retry-After header when rate limited', async () => {
    checkRateLimitMock.mockResolvedValue({ allowed: false, retryAfter: 42 });
    const res = await GET(req(validQs));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
    expect(poolMock.query).not.toHaveBeenCalled();
  });

  it('defaults Retry-After to 60 when the limiter does not supply one', async () => {
    checkRateLimitMock.mockResolvedValue({ allowed: false });
    const res = await GET(req(validQs));
    expect(res.headers.get('Retry-After')).toBe('60');
  });

  it('queries get_property_clusters with bounds ordered (lat, lon, lat, lon, zoom) and returns a FeatureCollection', async () => {
    const features = [{ type: 'Feature', properties: { count: 3 } }];
    poolMock.query.mockResolvedValue({ rows: [{ clusters: features }] });

    const res = await GET(req(validQs));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ type: 'FeatureCollection', features });
    expect(poolMock.query).toHaveBeenCalledTimes(1);
    const [, values] = poolMock.query.mock.calls[0];
    expect(values).toEqual([30, -98, 31, -97, 10]);
  });

  it('returns an empty feature list when the DB reports no clusters', async () => {
    poolMock.query.mockResolvedValue({ rows: [{ clusters: null }] });
    const res = await GET(req(validQs));
    const body = await res.json();
    expect(body.features).toEqual([]);
  });

  it('extracts the client IP from the first x-forwarded-for entry for rate limiting', async () => {
    poolMock.query.mockResolvedValue({ rows: [{ clusters: [] }] });
    await GET(req(validQs, { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' }));
    expect(checkRateLimitMock).toHaveBeenCalledWith(expect.anything(), '203.0.113.5');
  });

  it('falls back to "unknown" when x-forwarded-for is absent', async () => {
    poolMock.query.mockResolvedValue({ rows: [{ clusters: [] }] });
    await GET(req(validQs));
    expect(checkRateLimitMock).toHaveBeenCalledWith(expect.anything(), 'unknown');
  });

  it('returns a generic 500 (never leaks internals) when the DB query throws', async () => {
    poolMock.query.mockRejectedValue(new Error('connection terminated unexpectedly'));
    const res = await GET(req(validQs));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Internal server error');
  });
});