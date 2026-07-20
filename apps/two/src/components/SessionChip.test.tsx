// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockSession = vi.hoisted(() => ({ value: null as null | { email: string; tier: string } }));
vi.mock('@/lib/useSessionUser', () => ({ useSessionUser: () => mockSession.value }));

import { SessionChip } from './SessionChip';

describe('SessionChip', () => {
  it('anon: sign-in link to one.octavo.press with next back to the terminal', () => {
    mockSession.value = null;
    render(<SessionChip />);
    const a = screen.getByRole('link', { name: /sign in/i });
    expect(a.getAttribute('href')).toBe(
      'https://one.octavo.press/login?next=https%3A%2F%2Ftwo.octavo.press%2F',
    );
  });

  it('free user: email + FREE badge + pricing link', () => {
    mockSession.value = { email: 'a@b.c', tier: 'free' };
    render(<SessionChip />);
    expect(screen.getByText('a@b.c')).toBeTruthy();
    expect(screen.getByText('FREE')).toBeTruthy();
    expect(screen.getByRole('link', { name: /go pro/i })).toBeTruthy();
  });

  it('pro user: email + PRO badge, no pricing link', () => {
    mockSession.value = { email: 'p@b.c', tier: 'pro' };
    render(<SessionChip />);
    expect(screen.getByText('PRO')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /go pro/i })).toBeNull();
  });
});
