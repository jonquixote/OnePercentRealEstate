import { describe, it, expect } from 'vitest';
import { parsePrefs, DEFAULT_PREFS } from './prefs-shared';

describe('parsePrefs', () => {
  it('empty input returns DEFAULT_PREFS', () => {
    expect(parsePrefs({})).toEqual(DEFAULT_PREFS);
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('garbage')).toEqual(DEFAULT_PREFS);
  });

  it('clamps ratePct to <= 15', () => {
    expect(parsePrefs({ financing: { ratePct: 99 } }).financing.ratePct).toBe(15);
    expect(parsePrefs({ financing: { ratePct: -5 } }).financing.ratePct).toBe(0);
  });

  it('clamps downPct 0-100, termYears 5-40, mgmt/vacancy 0-30', () => {
    const p = parsePrefs({
      financing: { downPct: 250, termYears: 2, mgmtPct: 999, vacancyPct: -9 },
    });
    expect(p.financing.downPct).toBe(100);
    expect(p.financing.termYears).toBe(5);
    expect(p.financing.mgmtPct).toBe(30);
    expect(p.financing.vacancyPct).toBe(0);
  });

  it('round-trips a valid area', () => {
    const p = parsePrefs({ areas: [{ label: 'Houston', zip: '77002' }] });
    expect(p.areas).toEqual([{ label: 'Houston', zip: '77002' }]);
  });

  it('drops malformed area entries (bad zip, missing label, non-object)', () => {
    const p = parsePrefs({
      areas: [
        { label: 'Houston', zip: '77002' },
        { label: 'Bad', zip: 'abc' },
        { label: '', zip: '77002' },
        { zip: '77002' },
        'not-an-object',
      ],
    });
    expect(p.areas).toEqual([{ label: 'Houston', zip: '77002' }]);
  });

  it('drops invalid strategy, keeps default', () => {
    expect(parsePrefs({ strategy: 'nope' }).strategy).toBe(DEFAULT_PREFS.strategy);
    expect(parsePrefs({ strategy: 'flip' }).strategy).toBe('flip');
  });

  it('preserves null tax/insurance sentinels', () => {
    const p = parsePrefs({ financing: { taxRatePct: 'x', insuranceMoYr: 1200 } });
    expect(p.financing.taxRatePct).toBeNull();
    expect(p.financing.insuranceMoYr).toBe(1200);
  });

  it('clamps taxRatePct 0-20 and insuranceMoYr 0-1000000', () => {
    expect(parsePrefs({ financing: { taxRatePct: 999 } }).financing.taxRatePct).toBe(20);
    expect(parsePrefs({ financing: { taxRatePct: -5 } }).financing.taxRatePct).toBe(0);
    expect(parsePrefs({ financing: { insuranceMoYr: -100 } }).financing.insuranceMoYr).toBe(0);
    expect(parsePrefs({ financing: { insuranceMoYr: 9e9 } }).financing.insuranceMoYr).toBe(1000000);
  });
});
