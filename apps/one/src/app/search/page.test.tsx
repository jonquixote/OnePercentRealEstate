// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import type { ReactNode } from 'react';

/**
 * Issue #53: the search page's "Include sold" pill toggles the `sold` nuqs
 * param, which must flow into the property request as `includeSold`. The map,
 * server action, and prefs hook are stubbed; NuqsTestingAdapter runs in
 * `hasMemory` mode so param writes round-trip back into the component (the full
 * control → param → request chain is exercised).
 */

const h = vi.hoisted(() => ({
  getProperties: vi.fn(async () => ({ items: [], nextCursor: null })),
}));

vi.mock('@/app/actions', () => ({ getProperties: h.getProperties }));
vi.mock('@/components/PropertyMap', () => ({ PropertyMap: () => null }));
vi.mock('@oper/map/controls/DrawSearch', () => ({ DrawSearch: () => null }));
vi.mock('@/components/search/SearchCard', () => ({ SearchCard: () => null }));
vi.mock('@/components/search/ResultsTable', () => ({ ResultsTable: () => null }));
vi.mock('@/components/WatchSearchButton', () => ({ WatchSearchButton: () => null }));
vi.mock('@/components/search/FirstRunCoach', () => ({ FirstRunCoach: () => null }));
vi.mock('@/lib/prefs', () => ({
  usePrefs: () => ({ prefs: { areas: [] }, save: async () => true, loading: false }),
}));
const sessionState = vi.hoisted(() => ({ user: null as null | { id: string; email: string; tier: 'free' } }));
vi.mock('@/lib/useSessionUser', () => ({
  useSessionUser: () => sessionState.user,
}));

import SearchPage from './page';

function renderPage(searchParams = '') {
  return render(<SearchPage />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <NuqsTestingAdapter searchParams={searchParams} hasMemory>
        {children}
      </NuqsTestingAdapter>
    ),
  });
}

// The filters object is the 4th positional arg to getProperties(page, limit, sortBy, filters).
function includeSoldOf(call: unknown[]): unknown {
  return (call[3] as { includeSold?: unknown } | undefined)?.includeSold;
}

afterEach(() => cleanup());
beforeEach(() => h.getProperties.mockClear());

describe('SearchPage — "Include sold" control wiring (#53)', () => {
  it('defaults to hiding sold, then flows includeSold:true after toggling', async () => {
    renderPage();

    // Initial (default) load: sold hidden → includeSold is falsy.
    await waitFor(() => expect(h.getProperties).toHaveBeenCalled());
    expect(h.getProperties.mock.calls.every((c) => !includeSoldOf(c))).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /include sold/i }));

    await waitFor(
      () => expect(h.getProperties.mock.calls.some((c) => includeSoldOf(c) === true)).toBe(true),
      { timeout: 3000 },
    );
  });

  it('reflects the sold param state via aria-pressed', () => {
    renderPage('?sold=true');
    const pill = screen.getByRole('button', { name: /include sold/i });
    expect(pill.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('SearchPage — warm welcome CTA (#empty-states)', () => {
  it('shows the /welcome CTA above results when signed in with no areas', async () => {
    sessionState.user = { id: 'u1', email: 'a@b.co', tier: 'free' };
    renderPage();
    const link = await screen.findByRole('link', { name: /Tell us your markets/i });
    expect(link.getAttribute('href')).toBe('/welcome');
  });

  it('hides the CTA when signed out', async () => {
    sessionState.user = null;
    renderPage();
    await waitFor(() => expect(h.getProperties).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: /Tell us your markets/i })).toBeNull();
  });

  it('dismisses the CTA and persists to localStorage', async () => {
    sessionState.user = { id: 'u1', email: 'a@b.co', tier: 'free' };
    localStorage.clear();
    renderPage();
    const link = await screen.findByRole('link', { name: /Tell us your markets/i });
    expect(link).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Dismiss/i }));
    expect(localStorage.getItem('welcome-cta-dismissed')).toBe('1');
    expect(screen.queryByRole('link', { name: /Tell us your markets/i })).toBeNull();
  });
});
