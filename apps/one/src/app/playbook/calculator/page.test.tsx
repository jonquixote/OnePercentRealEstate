// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import CalculatorPage from './page';

afterEach(() => cleanup());

beforeEach(() => {
  vi.resetAllMocks();
  // Mock /api/prefs to return ratePct 5.5.
  global.fetch = vi.fn(async (url: string) => {
    if (url.includes('/api/prefs')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          financing: { ratePct: 5.5, downPct: 25, termYears: 30, taxRatePct: 1.1, insuranceMoYr: 1500, mgmtPct: 8, vacancyPct: 8 },
          areas: [],
          strategy: 'buy_hold',
        }),
      } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
});

describe('CalculatorPage pre-fill', () => {
  it('seeds the interest-rate input from prefs.ratePct', async () => {
    render(<CalculatorPage />);
    const rate = (await screen.findByLabelText(/interest rate/i)) as HTMLInputElement;
    await waitFor(() => expect(rate.value).toBe('0.055'));
    expect(rate.value).toBe('0.055');
  });

  it('keeps a manual edit when prefs arrive after touch', async () => {
    render(<CalculatorPage />);
    const rate = (await screen.findByLabelText(/interest rate/i)) as HTMLInputElement;
    fireEvent.change(rate, { target: { value: '0.08' } });
    await waitFor(() => expect(rate.value).toBe('0.08'));
    // preset sync must NOT clobber it
    expect(rate.value).toBe('0.08');
  });
});
