// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { SpotlightRotator } from './SpotlightRotator';
import type { TourEntry } from '@/lib/spotlight';

const entry = (zip: string, label: string): TourEntry => ({
  metro: { label, zip },
  deal: {
    id: '9', address: `${zip} Main St`, listing_price: 90000, estimated_rent: 1200,
    ratio: 0.0133, rent_low: 1100, rent_high: 1300, primary_photo: null, zip,
  },
});

beforeEach(() => {
  vi.restoreAllMocks();
  // jsdom has no matchMedia; useReducedMotion subscribes to it on mount.
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: false, media: q,
    addEventListener: () => {}, removeEventListener: () => {},
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('SpotlightRotator', () => {
  it('renders the server first frame until the client takes over', () => {
    render(
      <SpotlightRotator entries={[entry('77002', 'Houston')]} startIndex={0}>
        <div data-testid="server-frame">server</div>
      </SpotlightRotator>,
    );
    expect(screen.getByTestId('server-frame')).toBeTruthy();
  });

  it('shows a visible alert when a pinned ZIP has no deal — never a silent failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ metro: { label: 'X', zip: '00000' }, deal: null }),
    }));
    render(
      <SpotlightRotator entries={[entry('77002', 'Houston')]} startIndex={0}>
        <div>server</div>
      </SpotlightRotator>,
    );
    fireEvent.change(screen.getByLabelText(/pin a zip/i), { target: { value: '00000' } });
    fireEvent.submit(screen.getByRole('button', { name: /go/i }).closest('form')!);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });

  it('surfaces a network failure as an alert too', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(
      <SpotlightRotator entries={[entry('77002', 'Houston')]} startIndex={0}>
        <div>server</div>
      </SpotlightRotator>,
    );
    fireEvent.change(screen.getByLabelText(/pin a zip/i), { target: { value: '44113' } });
    fireEvent.submit(screen.getByRole('button', { name: /go/i }).closest('form')!);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });

  it('ignores a non-5-digit ZIP without fetching', () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    render(
      <SpotlightRotator entries={[entry('77002', 'Houston')]} startIndex={0}>
        <div>server</div>
      </SpotlightRotator>,
    );
    fireEvent.change(screen.getByLabelText(/pin a zip/i), { target: { value: '12' } });
    fireEvent.submit(screen.getByRole('button', { name: /go/i }).closest('form')!);
    expect(f).not.toHaveBeenCalled();
  });

  it('swaps to the pinned deal and offers to resume the tour', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => entry('44113', 'Cleveland'),
    }));
    render(
      <SpotlightRotator entries={[entry('77002', 'Houston')]} startIndex={0}>
        <div data-testid="server-frame">server</div>
      </SpotlightRotator>,
    );
    fireEvent.change(screen.getByLabelText(/pin a zip/i), { target: { value: '44113' } });
    fireEvent.submit(screen.getByRole('button', { name: /go/i }).closest('form')!);
    await waitFor(() => expect(screen.getByText(/resume tour/i)).toBeTruthy());
    // The server frame is gone — the pinned card replaced it.
    expect(screen.queryByTestId('server-frame')).toBeNull();
  });
});

describe('SpotlightRotator verdict pairing', () => {
  const two = [entry('77002', 'Houston'), entry('44113', 'Cleveland')];
  const verdicts = [
    <p key="a" data-testid="v-77002">verdict for 77002</p>,
    <p key="b" data-testid="v-44113">verdict for 44113</p>,
  ];

  it('shows the verdict belonging to the entry currently on screen', () => {
    render(
      <SpotlightRotator entries={two} startIndex={0} verdicts={verdicts}>
        <div>server</div>
      </SpotlightRotator>,
    );
    // Index 0 is the server frame's entry, so its verdict — and only its
    // verdict — is on screen. A verdict rendered for the wrong entry would
    // attach one property's analysis to another.
    expect(screen.getByTestId('v-77002')).toBeTruthy();
    expect(screen.queryByTestId('v-44113')).toBeNull();
  });

  it('drops the verdict entirely when a ZIP is pinned, rather than showing a stale one', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => entry('30310', 'Atlanta'),
    }));
    render(
      <SpotlightRotator entries={two} startIndex={0} verdicts={verdicts}>
        <div>server</div>
      </SpotlightRotator>,
    );
    fireEvent.change(screen.getByLabelText(/pin a zip/i), { target: { value: '30310' } });
    fireEvent.submit(screen.getByRole('button', { name: /go/i }).closest('form')!);

    await waitFor(() => expect(screen.getByText(/resume tour/i)).toBeTruthy());
    // The pinned deal was fetched at runtime and has no server-rendered
    // verdict. Neither tour verdict may leak onto it.
    expect(screen.queryByTestId('v-77002')).toBeNull();
    expect(screen.queryByTestId('v-44113')).toBeNull();
  });

  it('renders without verdicts at all — the prop is optional', () => {
    render(
      <SpotlightRotator entries={two} startIndex={0}>
        <div data-testid="server-frame">server</div>
      </SpotlightRotator>,
    );
    expect(screen.getByTestId('server-frame')).toBeTruthy();
  });
});
