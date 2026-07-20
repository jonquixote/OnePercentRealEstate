// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import UpgradeMoment from './UpgradeMoment';

function href(el: Element | null): string | null {
  return el?.getAttribute('href') ?? null;
}

describe('UpgradeMoment', () => {
  afterEach(() => cleanup());

  it('renders the compare gate headline and pricing link', () => {
    render(<UpgradeMoment gate="compare" />);
    expect(screen.getByText(/Compare is a Pro feature/i)).toBeTruthy();
    const link = screen.getByRole('link');
    expect(href(link)).toContain('/pricing?from=compare');
  });

  it('renders the alerts gate free alternative and pricing link', () => {
    render(<UpgradeMoment gate="alerts" />);
    expect(screen.getByText(/Daily digest stays free/i)).toBeTruthy();
    const link = screen.getByRole('link');
    expect(href(link)).toContain('/pricing?from=alerts');
  });

  it('renders the layouts gate pricing link', () => {
    render(<UpgradeMoment gate="layouts" />);
    const link = screen.getByRole('link');
    expect(href(link)).toContain('/pricing?from=layouts');
  });
});
