'use client';

import { useCallback, useEffect, useState } from 'react';
/**
 * InvestorPrefs — per-user financing + watched-area presets stored in
 * `profiles.prefs` (jsonb). The object is the source of calculator / valuation
 * defaults; it is NEVER trusted raw from the client — `parsePrefs` clamps and
 * fills every field so downstream code can read a complete, valid object.
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
  areas: Array<{ label: string; zip: string }>; // watched areas (metro chips or ZIPs)
  strategy: Strategy;
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
    .map((a) => ({ label: typeof a.label === 'string' ? a.label : '', zip: typeof a.zip === 'string' ? a.zip : '' }))
    .filter((a) => a.label.trim() !== '' && ZIP_RE.test(a.zip))
    .map((a) => ({ label: a.label, zip: a.zip }));

  const strategy: Strategy = STRATEGIES.includes(src.strategy as Strategy)
    ? (src.strategy as Strategy)
    : DEFAULT_PREFS.strategy;

  return {
    financing: {
      ratePct: clamp(num(fin.ratePct, DEFAULT_PREFS.financing.ratePct), 0, 15),
      downPct: clamp(num(fin.downPct, DEFAULT_PREFS.financing.downPct), 0, 100),
      termYears: clamp(num(fin.termYears, DEFAULT_PREFS.financing.termYears), 5, 40),
      taxRatePct: numOrNull(fin.taxRatePct),
      insuranceMoYr: numOrNull(fin.insuranceMoYr),
      mgmtPct: clamp(num(fin.mgmtPct, DEFAULT_PREFS.financing.mgmtPct), 0, 30),
      vacancyPct: clamp(num(fin.vacancyPct, DEFAULT_PREFS.financing.vacancyPct), 0, 30),
    },
    areas,
    strategy,
  };
}

/** Client hook: fetch prefs on mount, optimistic save, loading flag. */

export function usePrefs(): {
  prefs: InvestorPrefs;
  save: (p: InvestorPrefs) => Promise<boolean>;
  loading: boolean;
} {
  const [prefs, setPrefs] = useState<InvestorPrefs>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/prefs', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (active) setPrefs(parsePrefs(data));
        }
      } catch {
        /* keep defaults on network error */
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const save = useCallback(async (p: InvestorPrefs) => {
    const cleaned = parsePrefs(p);
    setPrefs(cleaned); // optimistic
    try {
      const res = await fetch('/api/prefs', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(cleaned),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  return { prefs, save, loading };
}
