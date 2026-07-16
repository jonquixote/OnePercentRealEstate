// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { FirstDealHero } from './FirstDealHero';

// next/image rejects the relative test-fixture src ("p.jpg") under jsdom; mock it
// as a plain <img> so the reveal renders. The real component receives absolute URLs.
vi.mock('next/image', () => ({
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

const deal = {
  id: '42', address: '123 Yield St', listing_price: 190000, estimated_rent: 2200,
  ratio: 2200 / 190000, rent_low: 2000, rent_high: 2400, primary_photo: 'p.jpg', zip: '77002',
};

beforeEach(() => {
  window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  vi.stubGlobal('fetch', vi.fn(async () =>
    ({ ok: true, json: async () => ({ metro: { label: 'Houston', zip: '77002' }, deal }) }) as Response));
});

describe('FirstDealHero', () => {
  it('reveals the spotlight deal and points the CTA at the metro search', async () => {
    render(<FirstDealHero initialMetroLabel="Houston" />);
    await waitFor(() => expect(screen.getByText('123 Yield St')).toBeTruthy());
    expect(screen.getByText('1.16%')).toBeTruthy(); // 2200/190000 = 1.157%
    const cta = screen.getByRole('link', { name: /more like this/i });
    expect(cta.getAttribute('href')).toBe('/search?q=77002');
  });
});
