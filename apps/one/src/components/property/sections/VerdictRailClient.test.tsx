// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import VerdictRailClient from './VerdictRailClient';

vi.mock('@/components/SaveButton', () => ({
  default: () => <button>save</button>,
}));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    json: async () => ({ rate: null }),
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const baseProps = {
  property: { id: 'abc-123' },
  hudData: null,
  price: 200000,
  rent: 2000,
  beds: 3 as const,
  sqft: 1200 as const,
  hasRent: true as const,
  ratioPct: 1.0 as number | null,
  targetPct: 1.0 as number,
  taxAnnual: 2400,
  insurance: 1200,
  hoa: null,
  monthlyCashflow: 100,
  capRate: 0.06,
  cashOnCash: 0.05,
};

type RailOverrides = Partial<typeof baseProps & { rentAssessment: any }>;

function renderRail(overrides: RailOverrides = {}) {
  return render(<VerdictRailClient {...baseProps} {...overrides} />);
}

describe('VerdictRailClient — trusted verdict (existing behavior)', () => {
  it('renders green ratio + target when verdict="trusted" and ratio ≥ target', () => {
    renderRail({
      ratioPct: 1.2,
      targetPct: 1.0,
      rentAssessment: {
        verdict: 'trusted',
        ratio: 0.012,
        reason: 'model agrees with anchors',
      },
    });
    expect(screen.getByText('1.20%')).toBeTruthy();
    expect(screen.getByText(/vs 1\.0% target/)).toBeTruthy();
    expect(screen.queryByText(/Clears the line/i)).toBeNull();
    expect(screen.queryByText(/Unverified/i)).toBeNull();
  });

  it('applies figure--pass class on ratio when trusted + ratio ≥ target (green)', () => {
    renderRail({
      ratioPct: 1.2,
      targetPct: 1.0,
      rentAssessment: {
        verdict: 'trusted',
        ratio: 0.012,
        reason: 'model agrees with anchors',
      },
    });
    const ratioEl = screen.getByText('1.20%');
    expect(ratioEl.className).toMatch(/figure--pass/);
  });

  it('renders ratio in haze color when verdict="trusted" but ratio below target', () => {
    renderRail({
      ratioPct: 0.8,
      targetPct: 1.0,
      rentAssessment: {
        verdict: 'trusted',
        ratio: 0.008,
        reason: 'model agrees with anchors',
      },
    });
    const ratio = screen.getByText('0.80%');
    expect(ratio.style.color).toBe('var(--haze)');
  });
});

describe('VerdictRailClient — implausible verdict', () => {
  it('renders "Unverified" caution copy in brass color (NOT green, NOT "Clears the line")', () => {
    renderRail({
      ratioPct: 2.5,
      targetPct: 1.0,
      rentAssessment: {
        verdict: 'implausible',
        ratio: 0.025,
        reason: 'model disagrees with HUD FMR beyond divergence cap',
      },
    });
    expect(screen.getByText(/Unverified/)).toBeTruthy();
    expect(screen.getByText(/model rent disagrees with HUD\/comps/i)).toBeTruthy();
    const unverified = screen.getByText(/Unverified/);
    expect(unverified.style.color).toBe('var(--brass)');
    expect(screen.queryByText(/Clears the line/i)).toBeNull();
  });

  it('shows a caution marker (⚠) on the ratio figure when implausible', () => {
    renderRail({
      ratioPct: 2.5,
      targetPct: 1.0,
      rentAssessment: {
        verdict: 'implausible',
        ratio: 0.025,
        reason: 'model disagrees with HUD FMR beyond divergence cap',
      },
    });
    const ratioNode = screen.getByText('2.50%');
    const container = ratioNode.parentElement;
    expect(container?.textContent).toMatch(/⚠/);
  });
});

describe('VerdictRailClient — wide verdict', () => {
  it('renders a "wide band" note without claiming implausibility', () => {
    renderRail({
      ratioPct: 1.05,
      targetPct: 1.0,
      rentAssessment: {
        verdict: 'wide',
        ratio: 0.0105,
        reason: 'model and anchors disagree moderately',
      },
    });
    expect(screen.getByText(/wide confidence band/i)).toBeTruthy();
    expect(screen.queryByText(/Unverified/i)).toBeNull();
    expect(screen.queryByText(/Cannot trust/i)).toBeNull();
    const wideNote = screen.getByText(/wide confidence band/i);
    expect(wideNote.style.color).toBe('var(--brass)');
  });
});

describe('VerdictRailClient — no assessment (back-compat)', () => {
  it('does not render verdict copy when rentAssessment is omitted', () => {
    renderRail({
      ratioPct: 1.2,
      targetPct: 1.0,
    });
    expect(screen.queryByText(/Unverified/i)).toBeNull();
    expect(screen.queryByText(/wide confidence band/i)).toBeNull();
  });
});
