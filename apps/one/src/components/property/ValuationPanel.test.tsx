// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ValuationPanel, type ValuationPayload } from './ValuationPanel';

afterEach(() => cleanup());

const years = Array.from({ length: 10 }, (_, k) => ({ year: k + 1, equity: 50000 + k * 5000, cumCashFlow: k * 1000, propertyValue: 200000 * (1.03 ** (k + 1)) }));

describe('ValuationPanel', () => {
  it('renders nothing when valuation is absent', () => {
    const { container } = render(<ValuationPanel valuation={null} />);
    expect(container.textContent).toBe('');
  });

  it('renders the intrinsic value and badge for a free payload', () => {
    const free: ValuationPayload = { intrinsic: 232000, marginOfSafety: 0.14, headline: '14% below intrinsic value' };
    render(<ValuationPanel valuation={free} />);
    expect(screen.getByText(/\$232,000/)).toBeTruthy();
    expect(screen.getByText(/14% below intrinsic value/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /pro/i })).toBeTruthy();
  });

  it('renders the equity multiple and table for a pro payload', () => {
    const pro: ValuationPayload = {
      intrinsic: 232000, marginOfSafety: 0.14, headline: 'x',
      ownerReturn: { years, equityMultiple: 2.4, avgAnnualCashOnCash: 0.06 },
      inputs: { provenance: ['cap rate: zip median'] },
    };
    render(<ValuationPanel valuation={pro} />);
    expect(screen.getByText(/2\.4×/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /pro/i })).toBeNull();
  });
});
