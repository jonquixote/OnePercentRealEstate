// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import AccountPage from './page';

interface SavedPrefs {
  financing: {
    ratePct: number;
    downPct: number;
    termYears: number;
    taxRatePct: number | null;
    insuranceMoYr: number | null;
    mgmtPct: number;
    vacancyPct: number;
  };
  areas: unknown[];
  strategy: string;
}

afterEach(() => cleanup());

beforeEach(() => {
  vi.resetAllMocks();
});

/**
 * Install the shared account-page fetch mock (auth/me, saved-searches,
 * watchlists, prefs GET). PUT /api/prefs captures the request body; the
 * returned getter exposes it once the save fires. Both tests drove identical
 * setup before — this is the single source (D2 cleanup).
 */
function installFetchMock(meUser: { id: string; email: string; tier: 'free' | 'pro'; stripeCustomerId: string | null } = { id: 'u1', email: 'a@b.co', tier: 'free', stripeCustomerId: null }): () => unknown {
  let savedBody: unknown = null;
  global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/api/auth/me')) return { ok: true, status: 200, json: async () => ({ user: meUser }) } as Response;
    if (url.includes('/api/saved-searches')) return { ok: true, status: 200, json: async () => [] } as Response;
    if (url.includes('/api/watchlists')) return { ok: true, status: 200, json: async () => [] } as Response;
    if (url.includes('/api/prefs') && (!init || init.method === undefined || init.method === 'GET')) {
      return { ok: true, status: 200, json: async () => ({ financing: { ratePct: 6.5, downPct: 20, termYears: 30, taxRatePct: null, insuranceMoYr: null, mgmtPct: 8, vacancyPct: 8 }, areas: [], strategy: 'buy_hold' }) } as Response;
    }
    if (url.includes('/api/prefs') && init?.method === 'PUT') {
      savedBody = JSON.parse(String(init.body));
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
  return () => savedBody;
}

describe('AccountPage presets', () => {
  it('renders defaults, edits rate, and saves clamped value via usePrefs', async () => {
    const getSavedBody = installFetchMock();

    render(<AccountPage />);
    const rate = await screen.findByLabelText(/rate/i) as HTMLInputElement;
    expect(rate.value).toBe('6.5');

    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(rate, '99');
    rate.dispatchEvent(new Event('input', { bubbles: true }));
    await waitFor(() => expect((screen.getByLabelText(/rate/i) as HTMLInputElement).value).toBe('99'));

    fireEvent.click(screen.getByRole('button', { name: /save presets/i }));

    await waitFor(() => expect(getSavedBody()).not.toBeNull());
    const body = getSavedBody() as SavedPrefs;
    expect(body.financing.ratePct).toBe(15); // clamped to ≤15
    expect(screen.getByText(/saved ✓/i)).toBeTruthy();
  });

  it('preserves null market-default sentinel (tax/insurance) on save without edit', async () => {
    const getSavedBody = installFetchMock();

    render(<AccountPage />);
    // tax/insurance fields should render empty (market default), not "0".
    const tax = (await screen.findByLabelText(/tax/i)) as HTMLInputElement;
    expect(tax.value).toBe('');

    fireEvent.click(screen.getByRole('button', { name: /save presets/i }));
    await waitFor(() => expect(getSavedBody()).not.toBeNull());
    const body = getSavedBody() as SavedPrefs;
    // The null sentinel must survive a save with no edits — must NOT become 0.
    expect(body.financing.taxRatePct).toBeNull();
    expect(body.financing.insuranceMoYr).toBeNull();
  });
});

describe('AccountPage billing', () => {
  it('shows "Manage billing" when session has a stripeCustomerId', async () => {
    installFetchMock({ id: 'u1', email: 'a@b.co', tier: 'pro', stripeCustomerId: 'cus_123' });
    render(<AccountPage />);
    expect(await screen.findByRole('button', { name: /manage billing/i })).toBeTruthy();
  });

  it('hides "Manage billing" when stripeCustomerId is null', async () => {
    installFetchMock({ id: 'u1', email: 'a@b.co', tier: 'free', stripeCustomerId: null });
    render(<AccountPage />);
    await screen.findByText(/account/i);
    expect(screen.queryByRole('button', { name: /manage billing/i })).toBeNull();
  });

  it('POSTs to /api/checkout/portal and redirects on success', async () => {
    installFetchMock({ id: 'u1', email: 'a@b.co', tier: 'pro', stripeCustomerId: 'cus_123' });
    let portalCalled = false;
    const realFetch = global.fetch;
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/checkout/portal')) {
        portalCalled = true;
        return { ok: true, status: 200, json: async () => ({ url: 'https://stripe.test/portal' }) } as Response;
      }
      return realFetch(url, init);
    }) as unknown as typeof fetch;
    const locationStub = { href: '' };
    Object.defineProperty(window, 'location', { value: locationStub, configurable: true, writable: true });
    render(<AccountPage />);
    fireEvent.click(await screen.findByRole('button', { name: /manage billing/i }));
    await waitFor(() => expect(portalCalled).toBe(true));
    await waitFor(() => expect(locationStub.href).toBe('https://stripe.test/portal'));
  });
});
