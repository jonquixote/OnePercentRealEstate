// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { OwnerReturnBreakdown } from './OwnerReturnBreakdown';

const years = Array.from({ length: 10 }, (_, k) => ({ year: k + 1, equity: 50000 + k * 5000, cumCashFlow: k * 1000, propertyValue: 200000 * (1.03 ** (k + 1)) }));

function stub(payload: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => payload }) as Response));
}

describe('OwnerReturnBreakdown', () => {
  it('renders the equity multiple when the API returns a pro payload', async () => {
    stub({ intrinsic: 232000, marginOfSafety: 0.14, headline: 'x', ownerReturn: { years, equityMultiple: 2.4, avgAnnualCashOnCash: 0.06 }, inputs: { provenance: ['cap rate: zip median'] } });
    render(<OwnerReturnBreakdown listingId="42" />);
    await waitFor(() => expect(screen.getByText(/2\.4×/)).toBeTruthy());
  });
  it('renders an upsell when the API omits ownerReturn (free tier)', async () => {
    stub({ intrinsic: 232000, marginOfSafety: 0.14, headline: 'x' });
    render(<OwnerReturnBreakdown listingId="42" />);
    await waitFor(() => expect(screen.getByRole('link', { name: /pro/i })).toBeTruthy());
  });
});
