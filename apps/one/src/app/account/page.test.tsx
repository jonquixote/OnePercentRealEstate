// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import AccountPage from './page';

afterEach(() => cleanup());

beforeEach(() => {
  vi.resetAllMocks();
});

describe('AccountPage presets', () => {
  it('renders defaults, edits rate, and saves clamped value via usePrefs', async () => {
    let savedBody: unknown = null;
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/auth/me')) return { ok: true, status: 200, json: async () => ({ user: { id: 'u1', email: 'a@b.co', tier: 'free' } }) } as Response;
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

    render(<AccountPage />);
    const rate = await screen.findByLabelText(/rate/i) as HTMLInputElement;
    expect(rate.value).toBe('6.5');

    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(rate, '99');
    rate.dispatchEvent(new Event('input', { bubbles: true }));
    await waitFor(() => expect((screen.getByLabelText(/rate/i) as HTMLInputElement).value).toBe('99'));

    fireEvent.click(screen.getByRole('button', { name: /save presets/i }));

    await waitFor(() => expect(savedBody).not.toBeNull());
    expect((savedBody as any).financing.ratePct).toBe(15); // clamped to ≤15
    expect(screen.getByText(/saved ✓/i)).toBeTruthy();
  });
});
