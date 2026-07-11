'use client';

// Compare selection state (D1). localStorage-backed so the tray survives
// navigation; capped at COMPARE_MAX for subscribers. The free tier is capped
// at COMPARE_FREE_MAX (Growth 1.3: Compare(>2) is the paid gate).
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useSessionUser } from '@/lib/useSessionUser';

const KEY = 'oper:compare';
export const COMPARE_MAX = 4;
export const COMPARE_FREE_MAX = 2;

interface CompareCtx {
  ids: string[];
  add: (id: string) => void;
  remove: (id: string) => void;
  toggle: (id: string) => void;
  clear: () => void;
  has: (id: string) => boolean;
  /** Effective selection cap for the current session (2 free / COMPARE_MAX pro). */
  limit: number;
  isPro: boolean;
}

const Ctx = createContext<CompareCtx | null>(null);

export function CompareProvider({ children }: { children: React.ReactNode }) {
  const [ids, setIds] = useState<string[]>([]);
  const session = useSessionUser();
  const isPro = session?.tier === 'pro';
  const limit = isPro ? COMPARE_MAX : COMPARE_FREE_MAX;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setIds(JSON.parse(raw).slice(0, COMPARE_MAX));
    } catch {
      /* ignore */
    }
  }, []);

  const persist = useCallback((next: string[]) => {
    setIds(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const add = useCallback(
    (id: string) => {
      setIds((prev) => {
        if (prev.includes(id) || prev.length >= limit) return prev;
        const next = [...prev, id];
        try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
    },
    [limit],
  );
  const remove = useCallback(
    (id: string) => {
      setIds((prev) => {
        const next = prev.filter((x) => x !== id);
        try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
    },
    [],
  );
  const toggle = useCallback(
    (id: string) => {
      setIds((prev) => {
        const next = prev.includes(id)
          ? prev.filter((x) => x !== id)
          : prev.length >= limit
            ? prev
            : [...prev, id];
        try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
    },
    [limit],
  );
  const clear = useCallback(() => persist([]), [persist]);
  const has = useCallback((id: string) => ids.includes(id), [ids]);

  return <Ctx.Provider value={{ ids, add, remove, toggle, clear, has, limit, isPro }}>{children}</Ctx.Provider>;
}

export function useCompare(): CompareCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Render-safe fallback for surfaces outside the provider (never throws
    // in production UI).
    return { ids: [], add: () => {}, remove: () => {}, toggle: () => {}, clear: () => {}, has: () => false, limit: COMPARE_FREE_MAX, isPro: false };
  }
  return ctx;
}
