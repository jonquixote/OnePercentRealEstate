import { describe, it, expect } from 'vitest';
import { parsePrefs, DEFAULT_PREFS } from './prefs-shared';

describe('parsePrefs onboarded + alertOptIn', () => {
  it('defaults both flags to false when input empty', () => {
    const p = parsePrefs({});
    expect(p.onboarded).toBe(false);
    expect(p.alertOptIn).toBe(false);
    expect(p.onboarded).toBe(DEFAULT_PREFS.onboarded);
    expect(p.alertOptIn).toBe(DEFAULT_PREFS.alertOptIn);
  });

  it('round-trips true values', () => {
    const p = parsePrefs({ onboarded: true, alertOptIn: true });
    expect(p.onboarded).toBe(true);
    expect(p.alertOptIn).toBe(true);
  });

  it('coerces junk onboarded via === true', () => {
    const p = parsePrefs({ onboarded: 'yes' });
    expect(p.onboarded).toBe(false);
  });

  it('coerces junk alertOptIn via === true', () => {
    const p = parsePrefs({ alertOptIn: 1 });
    expect(p.alertOptIn).toBe(false);
  });

  it('keeps fin clamp and area parsing intact (regression)', () => {
    const p = parsePrefs({ financing: { ratePct: 99 } });
    expect(p.financing.ratePct).toBe(15);
    const a = parsePrefs({ areas: [{ label: 'Houston', zip: '77002' }] });
    expect(a.areas).toEqual([{ label: 'Houston', zip: '77002' }]);
  });

  it('handles null and garbage input without throwing', () => {
    expect(parsePrefs(null).onboarded).toBe(false);
    expect(parsePrefs(null).alertOptIn).toBe(false);
    expect(parsePrefs('garbage').onboarded).toBe(false);
    expect(parsePrefs('garbage').alertOptIn).toBe(false);
  });
});
