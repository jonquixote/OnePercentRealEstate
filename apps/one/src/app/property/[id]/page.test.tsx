// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// A property that exists in neither the live table nor the archive must 404, not
// render a 200. getProperty is the read-through loader (live -> listings_archive);
// notFound() is Next's real-404 signal. The page pulls in a large component tree,
// so everything below the not-found decision is stubbed — this test only pins the
// status decision, which is the SEO-critical behaviour.
const h = vi.hoisted(() => ({ getProperty: vi.fn() }));

vi.mock('@/app/actions', () => ({
  getProperty: h.getProperty,
  getHudBenchmark: vi.fn().mockResolvedValue(null),
  getDemographics: vi.fn().mockResolvedValue(null),
}));

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
vi.mock('next/navigation', () => ({ notFound }));

// The page imports these at module load; stub so importing it is cheap and free
// of server-only side effects. None are reached on the not-found path.
vi.mock('@/lib/db', () => ({ default: { connect: vi.fn() } }));
vi.mock('@/lib/valuation', () => ({
  fetchValuationRow: vi.fn().mockResolvedValue(null),
  computeValuation: vi.fn(),
  getSessionPrefs: vi.fn(),
}));
vi.mock('@/app/api/valuation/[id]/route', () => ({ shapeResponse: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getSessionUser: vi.fn().mockResolvedValue(null) }));

describe('property page indexability', () => {
  beforeEach(() => {
    h.getProperty.mockReset();
    notFound.mockClear();
  });

  it('calls notFound() when the listing exists in neither table', async () => {
    h.getProperty.mockResolvedValue(null);
    const { default: Page } = await import('./page');
    await expect(Page({ params: Promise.resolve({ id: '99999999' }) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });

  it('does NOT call notFound() for an archived listing (it still renders)', async () => {
    // getProperty read-through returns an archived row; the page must not 404 it.
    // We only assert notFound() was not reached — full render is out of scope.
    h.getProperty.mockResolvedValue({ id: '5', address: '1 Old St', listing_status: 'stale', raw_data: {} });
    const { default: Page } = await import('./page');
    await Page({ params: Promise.resolve({ id: '5' }) }).catch(() => undefined);
    expect(notFound).not.toHaveBeenCalled();
  });
});

describe('property metadata robots', () => {
  beforeEach(() => h.getProperty.mockReset());

  it('de-indexes a listing unconfirmed past the SLO window', async () => {
    h.getProperty.mockResolvedValue({
      id: '7', address: '1 Stale St', raw_data: {},
      last_seen_at: new Date(Date.now() - 20 * 86_400_000).toISOString(),
    });
    const { generateMetadata } = await import('./page');
    const meta = await generateMetadata({ params: Promise.resolve({ id: '7' }) });
    expect(meta.robots).toEqual({ index: false, follow: true });
  });

  it('leaves a freshly confirmed listing indexable', async () => {
    h.getProperty.mockResolvedValue({
      id: '8', address: '1 Fresh St', raw_data: {},
      last_seen_at: new Date().toISOString(),
    });
    const { generateMetadata } = await import('./page');
    const meta = await generateMetadata({ params: Promise.resolve({ id: '8' }) });
    expect(meta.robots).toBeUndefined();
  });
});
