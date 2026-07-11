'use client';

// Compare selection state (D1). localStorage-backed so the tray survives
// navigation; capped at 4 — a comparison table wider than that stops being
// a comparison.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const KEY = 'oper:compare';
export const COMPARE_MAX = 4;

interface CompareCtx {
  ids: string[];
  add: (id: string) => void;
  remove: (id: string) => void;
  toggle: (id: string) => void;
  clear: () => void;
  has: (id: string) => boolean;
}

const Ctx = createContext<CompareCtx | null>(null);

export function CompareProvider({ children }: { children: React.ReactNode }) {
  const [ids, setIds] = useState<string[]>([]);

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
        if (prev.includes(id) || prev.length >= COMPARE_MAX) return prev;
        const next = [...prev, id];
        try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
    },
    [],
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
          : prev.length >= COMPARE_MAX
            ? prev
            : [...prev, id];
        try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
    },
    [],
  );
  const clear = useCallback(() => persist([]), [persist]);
  const has = useCallback((id: string) => ids.includes(id), [ids]);

  return <Ctx.Provider value={{ ids, add, remove, toggle, clear, has }}>{children}</Ctx.Provider>;
}

export function useCompare(): CompareCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Render-safe fallback for surfaces outside the provider (never throws
    // in production UI).
    return { ids: [], add: () => {}, remove: () => {}, toggle: () => {}, clear: () => {}, has: () => false };
  }
  return ctx;
}
