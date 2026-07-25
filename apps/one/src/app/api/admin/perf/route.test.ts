import { describe, it, expect, beforeEach, vi } from 'vitest';
import { trackRoute, __resetPerfTracking } from '@/lib/perf-track';

type Row = Record<string, unknown>;
const query = vi.fn(async (_sql?: string, _params?: unknown[]): Promise<{ rows: Row[] }> => ({ rows: [] }));
vi.mock('@/lib/db', () => ({ default: { query: (...a: unknown[]) => query(...(a as [])) } }));

beforeEach(() => {
  __resetPerfTracking();
  vi.unstubAllEnvs();
  query.mockClear();
  query.mockResolvedValue({ rows: [] });
});

async function call(auth?: string) {
  const { GET } = await import('./route');
  return GET(new Request('http://x/api/admin/perf', {
    headers: auth ? { authorization: auth } : {},
  }));
}

describe('/api/admin/perf', () => {
  it('401s without the admin key', async () => {
    vi.stubEnv('ADMIN_API_KEY', 'secret');
    expect((await call()).status).toBe(401);
    expect((await call('Bearer wrong')).status).toBe(401);
  });

  it('501s when no key is configured (never silently public)', async () => {
    vi.stubEnv('ADMIN_API_KEY', '');
    expect((await call('Bearer x')).status).toBe(501);
  });

  it('returns per-route percentiles, slowest first', async () => {
    vi.stubEnv('ADMIN_API_KEY', 'secret');
    for (let i = 0; i < 10; i++) { trackRoute('/api/stats', 5); trackRoute('/market/[zip]', 800); }
    const body = await (await call('Bearer secret')).json();
    expect(body.routes[0].route).toBe('/market/[zip]');
    expect(body.slowest[0].p95).toBeGreaterThan(100);
  });

  it('still reports routes from the persisted window after a restart', async () => {
    vi.stubEnv('ADMIN_API_KEY', 'secret');
    query.mockResolvedValueOnce({ rows: [
      { route: '/search', p50_ms: 200, p95_ms: 1400, p99_ms: 1800, max_ms: 2000, count: 80 },
    ] });
    const body = await (await call('Bearer secret')).json();
    expect(body.routes.map((r: { route: string }) => r.route)).toContain('/search');
  });

  it('POST flushes the aggregate and reports how many rows it wrote', async () => {
    vi.stubEnv('ADMIN_API_KEY', 'secret');
    trackRoute('/api/stats', 5);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x/api/admin/perf', {
      method: 'POST', headers: { authorization: 'Bearer secret' },
    }));
    expect(await res.json()).toEqual({ ok: true, written: 1 });
  });
});
