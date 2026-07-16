// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { IntrinsicValueCard } from './IntrinsicValueCard';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, json: async () => ({ intrinsic: 232000, marginOfSafety: 0.14, headline: '14% below intrinsic value' }),
  }) as Response));
});

describe('IntrinsicValueCard', () => {
  it('shows the intrinsic value and a positive margin-of-safety badge', async () => {
    render(<IntrinsicValueCard listingId="42" />);
    await waitFor(() => expect(screen.getByText(/\$232,000/)).toBeTruthy());
    expect(screen.getByText(/14% below intrinsic value/)).toBeTruthy();
  });
});
