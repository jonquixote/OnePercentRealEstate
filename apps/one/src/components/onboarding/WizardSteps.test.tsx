import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { WizardSteps } from './WizardSteps';
import { DEFAULT_PREFS, type InvestorPrefs } from '@/lib/prefs-shared';
import { METROS } from '@/lib/metros';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

afterEach(() => cleanup());

function makePrefs(over: Partial<InvestorPrefs> = {}): InvestorPrefs {
  return { ...DEFAULT_PREFS, ...over };
}

describe('WizardSteps', () => {
  beforeEach(() => {
    push.mockClear();
  });

  it('step 1 renders all METROS chips; selecting two + Next → step 2; Finish saves onboarded with 2 areas + alertOptIn', async () => {
    const save = vi.fn().mockResolvedValue(true);
    const prefs = makePrefs();
    render(<WizardSteps prefs={prefs} save={save} />);

    // All 8 metros present
    for (const m of METROS) {
      expect(screen.getByText(new RegExp(`\\+ ${m.label}`))).toBeTruthy();
    }

    // Select two chips
    const first = screen.getByText(new RegExp(`\\+ ${METROS[0].label}`));
    const second = screen.getByText(new RegExp(`\\+ ${METROS[1].label}`));
    fireEvent.click(first);
    fireEvent.click(second);

    // Advance to step 2
    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByText('Down %')).toBeTruthy();

    // Advance to step 3
    fireEvent.click(screen.getByText('Next'));
    const toggle = screen.getByText(/Email me instant deals/i);
    expect(toggle).toBeTruthy();

    // Toggle the checkbox on
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    // Finish
    fireEvent.click(screen.getByText('Finish'));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const saved = save.mock.calls[0][0] as InvestorPrefs;
    expect(saved.onboarded).toBe(true);
    expect(saved.alertOptIn).toBe(true);
    expect(saved.areas).toHaveLength(2);
    expect(saved.areas.map((a) => a.label).sort()).toEqual([METROS[0].label, METROS[1].label].sort());
    expect(saved.areas[0]).toEqual({ label: METROS[0].label, zip: METROS[0].zip, city: METROS[0].city, state: METROS[0].state });
    expect(saved.areas[1]).toEqual({ label: METROS[1].label, zip: METROS[1].zip, city: METROS[1].city, state: METROS[1].state });
    expect(push).toHaveBeenCalledWith('/search');
  });

  it('Skip for now on step 1 saves onboarded:true and routes to /search', async () => {
    const save = vi.fn().mockResolvedValue(true);
    render(<WizardSteps prefs={makePrefs()} save={save} />);

    fireEvent.click(screen.getByText('Skip for now'));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const saved = save.mock.calls[0][0] as InvestorPrefs;
    expect(saved.onboarded).toBe(true);
    expect(push).toHaveBeenCalledWith('/search');
  });
});
