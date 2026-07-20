/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { ENTITLEMENTS, entitlementsFor } from './entitlements';

describe('entitlements', () => {
  it('pro tier', () => {
    const e = entitlementsFor('pro');
    expect(e.compareMax).toBe(4);
    expect(e.layoutsMax).toBe(20);
    expect(e.alerts).toBe('instant');
  });

  it('free tier', () => {
    const e = entitlementsFor('free');
    expect(e.compareMax).toBe(2);
    expect(e.layoutsMax).toBe(5);
    expect(e.alerts).toBe('daily');
  });

  it('undefined defaults to free', () => {
    const e = entitlementsFor(undefined);
    expect(e.compareMax).toBe(2);
    expect(e.alerts).toBe('daily');
  });

  it('null defaults to free', () => {
    const e = entitlementsFor(null);
    expect(e.compareMax).toBe(2);
    expect(e.alerts).toBe('daily');
  });

  it('ENTITLEMENTS has exactly free and pro', () => {
    expect(Object.keys(ENTITLEMENTS).sort()).toEqual(['free', 'pro']);
  });
});
