import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MetadataRoute } from 'next';
import { INDEX_METROS } from '@/lib/index-metros';

const { mockConnect, mockQuery, mockRelease } = vi.hoisted(() => {
    const mockQuery = vi.fn();
    const mockRelease = vi.fn();
    const mockConnect = vi.fn().mockResolvedValue({ query: mockQuery, release: mockRelease });
    return { mockConnect, mockQuery, mockRelease };
});

vi.mock('@/lib/db', () => ({
    default: { connect: (...args: unknown[]) => mockConnect(...args) },
}));

function mockRows(rows: Record<string, unknown>[]) {
    mockQuery.mockResolvedValueOnce({ rows });
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('sitemap generateSitemaps', () => {
    it('returns descriptors for markets, sold, index, and property shards', async () => {
        mockRows([{ count: '0' }]);
        const { generateSitemaps } = await import('./sitemap');
        const result = await generateSitemaps();
        const ids = result.map((s) => s.id);
        expect(ids).toContain('markets');
        expect(ids).toContain('sold');
        expect(ids).toContain('index');
        expect(ids.some((id) => id.startsWith('property-'))).toBe(true);
    });
});

describe('sitemap markets', () => {
    it('returns core routes + market zip routes', async () => {
        mockRows([
            { zip_code: '90001' },
            { zip_code: '77001' },
        ]);
        const { default: sitemap } = await import('./sitemap');
        const result: MetadataRoute.Sitemap = await sitemap({ id: 'markets' });
        const urls = result.map((r) => r.url);
        expect(urls).toContain('https://one.octavo.press');
        expect(urls).toContain('https://one.octavo.press/search');
        expect(urls).toContain('https://one.octavo.press/market/90001');
        expect(urls).toContain('https://one.octavo.press/market/77001');
        expect(result[0].changeFrequency).toBe('daily');
        expect(result[0].priority).toBe(1);
    });

    it('returns only core routes when query fails', async () => {
        mockQuery.mockRejectedValueOnce(new Error('db down'));
        const { default: sitemap } = await import('./sitemap');
        const result: MetadataRoute.Sitemap = await sitemap({ id: 'markets' });
        expect(result.length).toBeGreaterThanOrEqual(1);
        expect(result.every((r) => !r.url.includes('/market/'))).toBe(true);
    });
});

describe('sitemap sold', () => {
    it('returns /sold/:id routes', async () => {
        mockRows([{ id: 'abc-123' }, { id: 'def-456' }]);
        const { default: sitemap } = await import('./sitemap');
        const result: MetadataRoute.Sitemap = await sitemap({ id: 'sold' });
        const urls = result.map((r) => r.url);
        expect(urls).toContain('https://one.octavo.press/sold/abc-123');
        expect(urls).toContain('https://one.octavo.press/sold/def-456');
    });

    it('returns empty on query failure', async () => {
        mockQuery.mockRejectedValueOnce(new Error('fail'));
        const { default: sitemap } = await import('./sitemap');
        const result = await sitemap({ id: 'sold' });
        expect(result).toEqual([]);
    });
});

describe('sitemap index', () => {
    it('returns /the-1-percent-index + metro slug routes', async () => {
        const { default: sitemap } = await import('./sitemap');
        const result: MetadataRoute.Sitemap = await sitemap({ id: 'index' });
        const urls = result.map((r) => r.url);
        expect(urls).toContain('https://one.octavo.press/the-1-percent-index');
        expect(urls).toContain('https://one.octavo.press/the-1-percent-index/houston');
        expect(urls).toContain('https://one.octavo.press/the-1-percent-index/chicago');
        expect(result.length).toBe(INDEX_METROS.length + 1);
    });
});

describe('sitemap property', () => {
    it('returns /property/:id routes with daily changeFrequency', async () => {
        mockRows([
            { id: 'prop-1', rent_price_ratio: 1.2 },
            { id: 'prop-2', rent_price_ratio: null },
        ]);
        const { default: sitemap } = await import('./sitemap');
        const result: MetadataRoute.Sitemap = await sitemap({ id: 'property-0' });
        const urls = result.map((r) => r.url);
        expect(urls).toContain('https://one.octavo.press/property/prop-1');
        expect(urls).toContain('https://one.octavo.press/property/prop-2');
        expect(result[0].changeFrequency).toBe('daily');
    });

    it('assigns priority 0.9 when rent_price_ratio >= 0.01', async () => {
        mockRows([{ id: 'p1', rent_price_ratio: 1.5 }]);
        const { default: sitemap } = await import('./sitemap');
        const result = await sitemap({ id: 'property-0' });
        expect(result[0].priority).toBe(0.9);
    });

    it('assigns priority 0.6 when rent_price_ratio is null', async () => {
        mockRows([{ id: 'p2', rent_price_ratio: null }]);
        const { default: sitemap } = await import('./sitemap');
        const result = await sitemap({ id: 'property-0' });
        expect(result[0].priority).toBe(0.6);
    });
});

describe('sitemap unknown id', () => {
    it('returns empty array', async () => {
        const { default: sitemap } = await import('./sitemap');
        const result = await sitemap({ id: 'nonexistent' });
        expect(result).toEqual([]);
    });
});

// Next passes the numeric position from generateSitemaps, not the id string —
// the prod 500 (`e.startsWith is not a function`) came from assuming a string.
describe('sitemap numeric ids (Next passes position, not the id string)', () => {
    it('0 → markets', async () => {
        mockRows([{ zip_code: '77002' }]);
        const { default: sitemap } = await import('./sitemap');
        const result = await sitemap({ id: 0 as unknown as string });
        expect(result.map((r) => r.url)).toContain('https://one.octavo.press/market/77002');
    });
    it('1 → sold', async () => {
        mockRows([{ id: 's1' }]);
        const { default: sitemap } = await import('./sitemap');
        const result = await sitemap({ id: 1 as unknown as string });
        expect(result.map((r) => r.url)).toContain('https://one.octavo.press/sold/s1');
    });
    it('2 → index (static, issues no DB query)', async () => {
        const { default: sitemap } = await import('./sitemap');
        const result = await sitemap({ id: 2 as unknown as string });
        expect(result.map((r) => r.url)).toContain('https://one.octavo.press/the-1-percent-index');
    });
    it('3 → first property shard (no throw)', async () => {
        mockRows([{ id: 'p9', rent_price_ratio: 1.1 }]);
        const { default: sitemap } = await import('./sitemap');
        const result = await sitemap({ id: 3 as unknown as string });
        expect(result.map((r) => r.url)).toContain('https://one.octavo.press/property/p9');
    });
});
