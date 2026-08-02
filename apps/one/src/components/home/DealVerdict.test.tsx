// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DealVerdict } from './DealVerdict';
import type { LensVerdict } from '@/lib/underwrite-deal';

const ok = (strategy: LensVerdict['strategy'], grade: 'A' | 'B' | 'C'): LensVerdict => ({
  strategy,
  available: true,
  grade,
  headline: 'Clears the line',
  metrics: [
    { label: 'Cap rate', value: '6.20%', threshold: '5.00%', met: true },
    { label: 'DSCR', value: '1.35', threshold: '1.20', met: true },
    { label: 'GRM', value: '8.4×', threshold: '12.0×', met: true },
  ],
  assumptions: { downPaymentPct: 0.25, interestRate: 0.07, opexRatio: 0.5, resolvedTier: 'exact' },
});

const no = (strategy: LensVerdict['strategy'], reason: string): LensVerdict => ({
  strategy,
  available: false,
  reason,
  metrics: [],
});

afterEach(cleanup);

describe('DealVerdict', () => {
  it('leads with the chosen lens and shows each metric against its threshold', () => {
    render(
      <DealVerdict
        strategy="buy_hold"
        verdicts={[ok('buy_hold', 'B'), no('brrrr', 'thin comps'), no('flip', 'thin comps'), no('str', 'no ADR')]}
      />,
    );
    expect(screen.getByText('B')).toBeTruthy();
    // A value without its threshold is a number; with it, it is an argument.
    expect(screen.getByText('6.20%')).toBeTruthy();
    expect(screen.getByText(/5\.00%/)).toBeTruthy();
    expect(screen.getByText('3 of 3 tests passed')).toBeTruthy();
  });

  it('shows an unavailable lens its reason, never a grade', () => {
    render(
      <DealVerdict
        strategy="str"
        verdicts={[ok('buy_hold', 'B'), no('brrrr', 'thin comps'), no('flip', 'thin comps'), no('str', 'no nightly-rate feed')]}
      />,
    );
    expect(screen.getByText(/no nightly-rate feed/i)).toBeTruthy();
    expect(screen.queryByText(/tests passed/)).toBeNull();
  });

  it('offers a lens it CAN compute when the chosen one is unavailable', () => {
    render(
      <DealVerdict
        strategy="str"
        verdicts={[ok('buy_hold', 'B'), no('brrrr', 'thin comps'), no('flip', 'thin comps'), no('str', 'no nightly-rate feed')]}
      />,
    );
    // A refusal on its own is a dead end; the visitor gets somewhere to go.
    const link = screen.getByRole('link', { name: /underwrite it as Buy & Hold/i });
    expect(link.getAttribute('href')).toBe('/');
  });

  it('offers nothing when no lens is computable — rather than inventing a way forward', () => {
    render(
      <DealVerdict
        strategy="str"
        verdicts={[no('buy_hold', 'no rent'), no('brrrr', 'no rent'), no('flip', 'no rent'), no('str', 'no ADR')]}
      />,
    );
    expect(screen.queryByRole('link', { name: /underwrite it as/i })).toBeNull();
  });

  it('keeps every other lens visible, including the unavailable ones', () => {
    render(
      <DealVerdict
        strategy="buy_hold"
        verdicts={[ok('buy_hold', 'B'), no('brrrr', 'thin comps'), no('flip', 'thin comps'), no('str', 'no ADR')]}
      />,
    );
    // Hiding an unavailable lens would read as "this property fails for a
    // flipper", which is a different claim from "we cannot say".
    expect(screen.getAllByText(/thin comps/)).toHaveLength(2);
    expect(screen.getByText(/no ADR/)).toBeTruthy();
  });
});
