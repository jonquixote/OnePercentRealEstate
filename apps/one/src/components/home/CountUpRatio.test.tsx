// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CountUpRatio } from './CountUpRatio';

beforeAll(() => {
  // jsdom: force reduced-motion so the component renders the final value at once.
  window.matchMedia = ((q: string) => ({
    matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

describe('CountUpRatio', () => {
  it('renders the final percent immediately under reduced motion', () => {
    render(<CountUpRatio value={0.0118} />);
    expect(screen.getByText('1.18%')).toBeTruthy();
  });
});
