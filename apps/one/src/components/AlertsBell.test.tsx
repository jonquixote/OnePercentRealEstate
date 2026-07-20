// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const prefsState = vi.hoisted(() => ({ prefs: { strategy: 'buy_hold', financing: { ratePct: 7, downPct: 25 }, areas: [], onboarded: false } }));
vi.mock('@/lib/prefs', () => ({
  usePrefs: () => ({ prefs: prefsState.prefs, save: vi.fn(), loading: false }),
}));

import AlertsBell from './AlertsBell';

beforeEach(() => {
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ alerts: [], unread: 0 }) })) as unknown as typeof fetch;
});
afterEach(() => cleanup());

describe('AlertsBell — empty state', () => {
  it('shows "Pick your areas →" to /welcome when not onboarded', async () => {
    prefsState.prefs = { ...prefsState.prefs, onboarded: false };
    render(<AlertsBell />);
    fireEvent.click(screen.getByRole('button', { name: /Deal alerts/i }));
    const link = await screen.findByRole('link', { name: /Pick your areas/i });
    expect(link.getAttribute('href')).toBe('/welcome');
  });

  it('shows plain copy without the /welcome CTA when onboarded', async () => {
    prefsState.prefs = { ...prefsState.prefs, onboarded: true };
    render(<AlertsBell />);
    fireEvent.click(screen.getByRole('button', { name: /Deal alerts/i }));
    await screen.findByText(/Alerts land here when a deal clears the line in your areas/i);
    expect(screen.queryByRole('link', { name: /Pick your areas/i })).toBeNull();
  });
});
