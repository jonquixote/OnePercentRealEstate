import { describe, it, expect } from 'vitest';
import { freshnessOf } from './freshness';

const now = new Date('2026-08-02T12:00:00Z');
const ago = (h: number) => new Date(now.getTime() - h * 3600_000);

describe('freshnessOf', () => {
  it('is verified within a day', () => {
    expect(freshnessOf(ago(6), now).level).toBe('verified');
  });

  it('is recent between one and three days', () => {
    expect(freshnessOf(ago(48), now).level).toBe('recent');
  });

  it('is aging between three and seven days', () => {
    expect(freshnessOf(ago(120), now).level).toBe('aging');
  });

  it('is unconfirmed beyond seven days — the honest word for it', () => {
    expect(freshnessOf(ago(24 * 10), now).level).toBe('unconfirmed');
  });

  it('treats a missing timestamp as unconfirmed, never as fresh', () => {
    expect(freshnessOf(null, now).level).toBe('unconfirmed');
    expect(freshnessOf(undefined, now).level).toBe('unconfirmed');
  });

  it('treats an unparseable timestamp as unconfirmed rather than throwing', () => {
    expect(freshnessOf('not a date', now).level).toBe('unconfirmed');
  });

  it('accepts an ISO string, as it arrives from the database', () => {
    expect(freshnessOf(ago(6).toISOString(), now).level).toBe('verified');
  });

  it('never reports a future timestamp as stale', () => {
    expect(freshnessOf(new Date(now.getTime() + 3600_000), now).level).toBe('verified');
  });

  it('exposes the age in whole days for display', () => {
    expect(freshnessOf(ago(72), now).days).toBe(3);
    expect(freshnessOf(ago(1), now).days).toBe(0);
  });

  it('marks exactly the boundaries consistently', () => {
    expect(freshnessOf(ago(24), now).level).toBe('recent');
    expect(freshnessOf(ago(72), now).level).toBe('aging');
    expect(freshnessOf(ago(168), now).level).toBe('unconfirmed');
  });

  it('carries a label a user can read without a legend', () => {
    expect(freshnessOf(ago(24 * 10), now).label).toMatch(/unconfirmed/i);
    expect(freshnessOf(ago(6), now).label).toMatch(/today|hours/i);
  });
});
