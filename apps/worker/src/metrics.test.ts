import { describe, it, expect } from 'vitest';
import { ScraperPool } from './scraper-pool';
import { formatEndpointMetrics } from './metrics';

const CFG = { minIntervalMs: 5000, maxIntervalMs: 120000, startIntervalMs: 30000, decreaseMs: 1000, increaseFactor: 2, cooloffMs: 1000, cooloffMaxMs: 4000, jitterFrac: 0 };

describe('formatEndpointMetrics', () => {
  it('reports interval + counters per endpoint', () => {
    const p = new ScraperPool(['http://a'], CFG, () => 0);
    p.endpoints[0].settle('blocked', 0);
    const m = formatEndpointMetrics(p, 0)[0];
    expect(m.blocked).toBe(1);
    expect(m.interval_ms).toBe(60000);
  });
});
