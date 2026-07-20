// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { entitlementsFor, COMPARE_FREE_MAX, COMPARE_PRO_MAX } from '@/lib/entitlements';

// Default: Stripe key + agency price both present (the common case).
const ORIGINAL_ENV = { ...process.env };

function mockSearchParams(initial: URLSearchParams) {
  vi.doMock('next/navigation', () => ({
    useRouter: () => ({ push: vi.fn() }),
    useSearchParams: () => initial,
  }));
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_xxx';
  process.env.NEXT_PUBLIC_STRIPE_PRICE_AGENCY = 'price_agency_xxx';
});

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

async function loadPage(initial: URLSearchParams) {
  mockSearchParams(initial);
  const mod = await import('./page');
  render(<mod.default />);
}

describe('pricing page', () => {
  it('renders Free + Pro columns with compare row values from entitlements', async () => {
    await loadPage(new URLSearchParams());

    // Columns
    expect(screen.getByText('Free')).toBeTruthy();
    expect(screen.getByText('Pro Investor')).toBeTruthy();

    // Compare row: derive expected from the map so it stays in sync.
    const free = entitlementsFor('free');
    const pro = entitlementsFor('pro');
    expect(String(free.compareMax)).toBe(String(COMPARE_FREE_MAX));
    expect(String(pro.compareMax)).toBe(String(COMPARE_PRO_MAX));

    // Free column carries the free value for the compare label.
    const compareLabels = screen.getAllByText('Compare side-by-side');
    const freeRow = compareLabels[0].closest('tr')!;
    expect(freeRow.querySelectorAll('td')[1].textContent).toBe(String(COMPARE_FREE_MAX));
    // Pro column carries the pro value for the same label.
    const proRow = compareLabels[1].closest('tr')!;
    expect(proRow.querySelectorAll('td')[1].textContent).toBe(String(COMPARE_PRO_MAX));
  });

  it('adds brass-ring marker on Pro column when ?from=compare', async () => {
    await loadPage(new URLSearchParams({ from: 'compare' }));

    const proSection = document.querySelector('[data-from="compare"]')!;
    expect(proSection).toBeTruthy();
    // matching feature row carries the recommended tag
    const proRow = Array.from(proSection.querySelectorAll('tr')).find((tr) =>
      tr.getAttribute('data-from') === 'compare'
    )!;
    expect(proRow).toBeTruthy();
    expect(proRow.textContent).toContain('Recommended for you');
  });

  it('omits Agency column when agency price env is unset', async () => {
    delete process.env.NEXT_PUBLIC_STRIPE_PRICE_AGENCY;
    await loadPage(new URLSearchParams());
    expect(screen.queryByText('Agency Team')).toBeNull();
  });

  it('shows Agency column when agency price env is set', async () => {
    process.env.NEXT_PUBLIC_STRIPE_PRICE_AGENCY = 'price_agency_xxx';
    await loadPage(new URLSearchParams());
    expect(screen.getByText('Agency Team')).toBeTruthy();
  });

  it('falls back to mailto when Stripe publishable key is absent', async () => {
    delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    await loadPage(new URLSearchParams());

    const mailto = document.querySelector('a[href^="mailto:"]');
    expect(mailto).toBeTruthy();
    expect(mailto!.getAttribute('href')).toContain('sales@onepercent.com');
    expect(mailto!.textContent).toContain('Checkout coming online — email us');
  });
});
