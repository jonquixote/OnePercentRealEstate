import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { trackRoute, __resetPerfTracking } from '@oper/observability/perf-track';

beforeEach(() => { __resetPerfTracking(); });
afterEach(() => { vi.unstubAllEnvs(); });

async function call(auth?: string) {
  const { GET } = await import('./route');
  return GET(new Request('http://x/api/admin/perf', { headers: auth ? { authorization: auth } : {} }));
}

describe('two /api/admin/perf', () => {
  it('401s without the admin key', async () => {
    vi.stubEnv('ADMIN_API_KEY', 'secret');
    expect((await call()).status).toBe(401);
    expect((await call('Bearer wrong')).status).toBe(401);
  });

  it('501s when no key is configured — never silently public', async () => {
    vi.stubEnv('ADMIN_API_KEY', '');
    expect((await call('Bearer x')).status).toBe(501);
  });

  it('reports terminal routes slowest first, tagged as app two', async () => {
    vi.stubEnv('ADMIN_API_KEY', 'secret');
    for (let i = 0; i < 10; i++) { trackRoute('two.layouts', 4); trackRoute('two.market-series', 700); }
    const body = await (await call('Bearer secret')).json();
    expect(body.app).toBe('two');
    expect(body.routes[0].route).toBe('two.market-series');
    expect(body.slowest[0].p95).toBeGreaterThan(100);
  });
});
