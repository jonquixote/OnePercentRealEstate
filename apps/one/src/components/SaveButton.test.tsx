// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SaveButton, { SaveLink } from './SaveButton';

function href(el: Element | null): string | null {
  return el?.getAttribute('href') ?? null;
}

describe('SaveButton', () => {
  afterEach(() => cleanup());

  it('toggles on click and POSTs when saving', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 1, created: true }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<SaveButton listingId={123} />);
    const btn = screen.getByRole('button', { name: /save this property/i });
    expect(btn?.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(btn);
    // optimistic
    expect(screen.getByRole('button')?.getAttribute('aria-pressed')).toBe('true');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/saved-properties',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('DELETEs when un-saving', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<SaveButton listingId={123} initialSaved />);
    const btn = screen.getByRole('button', { name: /remove from saved/i });
    expect(btn?.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(btn);
    expect(screen.getByRole('button')?.getAttribute('aria-pressed')).toBe('false');
    expect(fetchMock).toHaveBeenCalledWith('/api/saved-properties?id=123', { method: 'DELETE' });
  });

  it('renders a sign-in link when fetch 401s on save', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<SaveButton listingId={123} />);
    fireEvent.click(screen.getByRole('button', { name: /save this property/i }));
    const link = await screen.findByRole('link', { name: /sign in to save/i });
    expect(href(link)).toBe('/account?next=/property/123');
  });
});

describe('SaveLink', () => {
  afterEach(() => cleanup());
  it('links to account with next param', () => {
    render(<SaveLink listingId={55} />);
    const link = screen.getByRole('link', { name: /sign in to save/i });
    expect(href(link)).toBe('/account?next=/property/55');
  });
});
