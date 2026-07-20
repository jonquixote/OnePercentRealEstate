/**
 * Pure, server-safe investor prefs types + parse logic. NO `'use client'`.
 * Imported by both client (`prefs.ts`) and server code (`valuation.ts`,
 * `api/prefs/route.ts`). The `'use client'` boundary lives only in `prefs.ts`.
 */
export type Strategy = 'buy_hold' | 'brrrr' | 'flip' | 'str';

export type InvestorPrefs = {
  financing: {
    ratePct: number; // annual mortgage rate, e.g. 6.5
    downPct: number; // 0-100
    termYears: number; // 5-40
    taxRatePct: number | null; // null = use market default
    insuranceMoYr: number | null; // annual $, null = market default
    mgmtPct: number; // property management % of rent
    vacancyPct: number; // 0-30
  };
  areas: Array<{ label: string; zip: string; city?: string; state?: string }>; // watched areas (metro chips or ZIPs)
  strategy: Strategy;
  onboarded?: boolean;
  alertOptIn?: boolean;
};

export const DEFAULT_PREFS: InvestorPrefs = {
  financing: {
    ratePct: 6.5,
    downPct: 20,
    termYears: 30,
    taxRatePct: null,
    insuranceMoYr: null,
    mgmtPct: 8,
    vacancyPct: 8,
  },
  areas: [],
  strategy: 'buy_hold',
  onboarded: false,
  alertOptIn: false,
};

const STRATEGIES: Strategy[] = ['buy_hold', 'brrrr', 'flip', 'str'];
const ZIP_RE = /^\d{5}$/;

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function clampNull(v: number | null, lo: number, hi: number): number | null {
  return v === null ? null : clamp(v, lo, hi);
}

/**
 * Lenient parse: merge any partial/garbage input onto DEFAULT_PREFS. Every
 * numeric field is clamped to its safe range; areas are validated (label
 * string + 5-digit zip) and malformed entries dropped. Never throws.
 */
export function parsePrefs(json: unknown): InvestorPrefs {
  const src = (json && typeof json === 'object' && !Array.isArray(json) ? json : {}) as Record<string, unknown>;
  const fin = (src.financing && typeof src.financing === 'object' ? src.financing : {}) as Record<string, unknown>;
  const areasRaw = Array.isArray(src.areas) ? src.areas : [];
  const areas = areasRaw
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
    .map((a) => {
      const label = typeof a.label === 'string' ? a.label : '';
      const zip = typeof a.zip === 'string' ? a.zip : '';
      const cityRaw = typeof a.city === 'string' ? a.city.trim() : '';
      const stateRaw = typeof a.state === 'string' ? a.state.trim().toUpperCase() : '';
      const validCity = cityRaw.length > 0 && cityRaw.length <= 40;
      const validState = /^[A-Z]{2}$/.test(stateRaw);
      const area: { label: string; zip: string; city?: string; state?: string } = { label, zip };
      if (validCity && validState) {
        area.city = cityRaw;
        area.state = stateRaw;
      }
      return area;
    })
    .filter((a) => a.label.trim() !== '' && ZIP_RE.test(a.zip));

  const strategy: Strategy = STRATEGIES.includes(src.strategy as Strategy)
    ? (src.strategy as Strategy)
    : DEFAULT_PREFS.strategy;

  const onboarded: boolean = src.onboarded === true;
  const alertOptIn: boolean = src.alertOptIn === true;

  return {
    financing: {
      ratePct: clamp(num(fin.ratePct, DEFAULT_PREFS.financing.ratePct), 0, 15),
      downPct: clamp(num(fin.downPct, DEFAULT_PREFS.financing.downPct), 0, 100),
      termYears: clamp(num(fin.termYears, DEFAULT_PREFS.financing.termYears), 5, 40),
      taxRatePct: clampNull(numOrNull(fin.taxRatePct), 0, 20),
      insuranceMoYr: clampNull(numOrNull(fin.insuranceMoYr), 0, 1000000),
      mgmtPct: clamp(num(fin.mgmtPct, DEFAULT_PREFS.financing.mgmtPct), 0, 30),
      vacancyPct: clamp(num(fin.vacancyPct, DEFAULT_PREFS.financing.vacancyPct), 0, 30),
    },
    areas,
    strategy,
    onboarded,
    alertOptIn,
  };
}
