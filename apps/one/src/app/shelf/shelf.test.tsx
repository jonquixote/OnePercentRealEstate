// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ShelfPage from './page';

afterEach(() => cleanup());

const SAVED = [
  { save_id: 11, note: null, saved_at: '2026-01-01', id: 'A', address: '111 First St', price: 100000, estimated_rent: 1200, rent_price_ratio: 0.012, primary_photo: 'https://x/a.jpg', zip_code: '77002', listing_status: null, sold_price: null, sold_date: null },
  { save_id: 12, note: 'good deal', saved_at: '2026-01-02', id: 'B', address: '222 Second St', price: 200000, estimated_rent: 2400, rent_price_ratio: 0.012, primary_photo: null, zip_code: '90004', listing_status: null, sold_price: null, sold_date: null },
];

const WATCHLISTS = [
  { id: 1, name: 'Cheap Houston', query_json: {}, created_at: '2026-01-01' },
];

function mockFetchFor(savedBody: unknown, watchlistsBody: unknown, opts: { deleteOk?: boolean } = {}) {
  const deleteOk = opts.deleteOk ?? true;
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/api/saved-properties') && init?.method === 'DELETE') {
      return { ok: deleteOk, status: deleteOk ? 200 : 500, json: async () => ({}) } as Response;
    }
    if (url.includes('/api/saved-properties')) {
      return { ok: true, status: 200, json: async () => savedBody } as Response;
    }
    if (url.includes('/api/watchlists')) {
      return { ok: true, status: 200, json: async () => watchlistsBody } as Response;
    }
    if (url.includes('/api/saved-searches')) {
      return { ok: true, status: 200, json: async () => [] } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('ShelfPage', () => {
  it('renders saved properties and enables compare with selected ids', async () => {
    global.fetch = mockFetchFor(SAVED, WATCHLISTS) as unknown as typeof fetch;
    render(<ShelfPage />);

    expect(await screen.findByRole('heading', { name: /Saved properties/i })).toBeTruthy();
    // Two saved cards rendered.
    expect(screen.getByText('111 First St')).toBeTruthy();
    expect(screen.getByText('222 Second St')).toBeTruthy();

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBe(2);

    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);

    const link = await screen.findByRole('link', { name: /Compare \(2\)/i });
    expect(link.getAttribute('href')).toBe('/compare?ids=A,B');
  });

  it('renders the Watched searches header for the criteria section', async () => {
    global.fetch = mockFetchFor([], WATCHLISTS) as unknown as typeof fetch;
    render(<ShelfPage />);
    expect(await screen.findByRole('heading', { name: /Watched searches/i })).toBeTruthy();
  });

  it('shows sticky bar with Remove (no compare link) for a single selected save', async () => {
    global.fetch = mockFetchFor(SAVED, WATCHLISTS) as unknown as typeof fetch;
    render(<ShelfPage />);

    expect(await screen.findByText('111 First St')).toBeTruthy();
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);

    // Sticky bar visible, Remove present, no compare link (needs >=2).
    expect(await screen.findByRole('button', { name: /Remove/i })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Compare/i })).toBeNull();
  });

  it('keeps a card when DELETE returns 4xx', async () => {
    global.fetch = mockFetchFor(SAVED, WATCHLISTS, { deleteOk: false }) as unknown as typeof fetch;
    render(<ShelfPage />);

    expect(await screen.findByText('111 First St')).toBeTruthy();
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);

    const removeBtn = await screen.findByRole('button', { name: /Remove/i });
    fireEvent.click(removeBtn);

    // Card remains because the server rejected the delete.
    expect(screen.getByText('111 First St')).toBeTruthy();
  });
});
