'use client';

import { useCallback, useEffect, useState } from 'react';
import { parsePrefs, DEFAULT_PREFS, type InvestorPrefs, type Strategy } from './prefs-shared';

export { parsePrefs, DEFAULT_PREFS, type InvestorPrefs, type Strategy } from './prefs-shared';

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
