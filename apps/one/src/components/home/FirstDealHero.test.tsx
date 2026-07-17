// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import { FirstDealHero } from './FirstDealHero';

const entry = (zip: string, label: string, addr: string) => ({
  metro: { label, zip },
  deal: {
    id: zip, address: addr, listing_price: 190000, estimated_rent: 2200,
    ratio: 2200 / 190000, rent_low: 2000, rent_high: 2400,
    primary_photo: 'p.jpg', zip,
  },
});
const ALL = {
  metros: [entry('77002', 'Houston', '1 Houston St'), entry('44102', 'Cleveland', '2 Cleveland Ave')],
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllTimers();
  // Pin the shuffle in useMetroRotation so the carousel starts at index 0
  // (Houston) and rotates to index 1 (Cleveland) deterministically.
  vi.spyOn(Math, 'random').mockReturnValue(0);
  window.matchMedia = ((q: string) => ({ matches: false, media: q,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  vi.stubGlobal('fetch', vi.fn(async (url: string) =>
    ({ ok: true, json: async () => (String(url).includes('all=1') ? ALL : entry('90004', 'Los Angeles', '3 LA Blvd')) }) as Response));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('FirstDealHero carousel', () => {
  it('renders the first metro with the city set in italic serif', async () => {
    render(<FirstDealHero />);
    await act(async () => { await Promise.resolve(); });
    const em = document.querySelector('h2 em');
    expect(em).not.toBeNull();
    expect(['Houston', 'Cleveland']).toContain(em!.textContent);
    expect(screen.getByRole('link', { name: /more like this/i })).toBeTruthy();
  });
  it('rotates to another metro after the interval', async () => {
    render(<FirstDealHero />);
    await act(async () => { await Promise.resolve(); });
    const first = document.querySelector('h2 em')!.textContent;
    await act(async () => { vi.advanceTimersByTime(6000); });
    expect(document.querySelector('h2 em')!.textContent).not.toBe(first);
  });
  it('typed ZIP pins the carousel to the fetched metro', async () => {
    render(<FirstDealHero />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.change(screen.getByLabelText(/city or zip/i), { target: { value: '90004' } });
    fireEvent.submit(document.querySelector('form')!);
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector('h2 em')!.textContent).toBe('Los Angeles');
    await act(async () => { vi.advanceTimersByTime(30000); });
    expect(document.querySelector('h2 em')!.textContent).toBe('Los Angeles'); // pinned
  });
  it('starts the tour on the geo-resolved metro', async () => {
    // Geo call resolves to Cleveland; the batch (all=1) is Houston, Cleveland.
    // random=0.6 makes shuffle keep order [Houston, Cleveland] so index 0 is
    // Houston WITHOUT geo-start — that isolates the geo-start behavior.
    vi.spyOn(Math, 'random').mockReturnValue(0.6);
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      ({ ok: true, json: async () => (String(url).includes('all=1')
        ? ALL
        : { metro: { label: 'Cleveland', zip: '44102' }, deal: ALL.metros[1].deal }) }) as Response));
    render(<FirstDealHero />);
    // Flush only the load microtasks — do NOT advance the 6s rotation timer.
    await act(async () => { await Promise.resolve(); });
    // Without geo-start the first city would be Houston (index 0); with it,
    // the tour opens on Cleveland regardless of shuffle order.
    expect(document.querySelector('h2 em')!.textContent).toBe('Cleveland');
  });
});
