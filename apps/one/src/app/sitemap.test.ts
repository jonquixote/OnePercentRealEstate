import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MetadataRoute } from 'next';

const { mockConnect, mockQuery, mockRelease } = vi.hoisted(() => {
    const mockQuery = vi.fn();
    const mockRelease = vi.fn();
    const mockConnect = vi.fn().mockResolvedValue({ query: mockQuery, release: mockRelease });
    return { mockConnect, mockQuery, mockRelease };
});

vi.mock('@/lib/db', () => ({
    default: { connect: (...args: unknown[]) => mockConnect(...args) },
}));

// The sitemap issues its queries in a fixed order: markets, then properties.
function mockQueries(marketRows: Record<string, unknown>[], propertyRows: Record<string, unknown>[]) {
    mockQuery
        .mockResolvedValueOnce({ rows: marketRows })
        .mockResolvedValueOnce({ rows: propertyRows });
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('sitemap (single flat file)', () => {
    it('includes core routes, the 1% index, market ZIPs, and top deals', async () => {
        mockQueries(
            [{ zip_code: '77002' }, { zip_code: 'bogus' }],
            [{ id: 'p1', rent_price_ratio: 1.2 }, { id: 'p2', rent_price_ratio: null }],
        );
        const { default: sitemap } = await import('./sitemap');
        const result: MetadataRoute.Sitemap = await sitemap();
        const urls = result.map((r) => r.url);
        // core
        expect(urls).toContain('https://one.octavo.press');
        expect(urls).toContain('https://one.octavo.press/search');
        // index
        expect(urls).toContain('https://one.octavo.press/the-1-percent-index');
        // markets (valid ZIP only; 'bogus' filtered out)
        expect(urls).toContain('https://one.octavo.press/market/77002');
        expect(urls).not.toContain('https://one.octavo.press/market/bogus');
        // properties
        expect(urls).toContain('https://one.octavo.press/property/p1');
        expect(urls).toContain('https://one.octavo.press/property/p2');
    });

    it('prioritizes 1%-clearing deals at 0.9, others at 0.6', async () => {
        mockQueries([], [{ id: 'hi', rent_price_ratio: 1.5 }, { id: 'lo', rent_price_ratio: null }]);
        const { default: sitemap } = await import('./sitemap');
        const result = await sitemap();
        const hi = result.find((r) => r.url.endsWith('/property/hi'));
        const lo = result.find((r) => r.url.endsWith('/property/lo'));
        expect(hi?.priority).toBe(0.9);
        expect(lo?.priority).toBe(0.6);
    });

    it('degrades to core + index routes when the DB is down (no throw)', async () => {
        mockQuery.mockRejectedValue(new Error('db down'));
        const { default: sitemap } = await import('./sitemap');
        const result = await sitemap();
        const urls = result.map((r) => r.url);
        expect(urls).toContain('https://one.octavo.press');
        expect(urls).toContain('https://one.octavo.press/the-1-percent-index');
        // no market/property rows when queries fail
        expect(urls.some((u) => u.includes('/market/'))).toBe(false);
        expect(urls.some((u) => u.includes('/property/'))).toBe(false);
    });
});
