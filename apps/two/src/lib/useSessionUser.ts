'use client';

/**
 * Client-side session hook for the pro terminal. Mirrors
 * apps/one/src/lib/useSessionUser.ts: fetches /api/auth/me once (lazily,
 * cached at module scope). In dev apps/two proxies /api/* to apps/one, so
 * the same session endpoint is reused.
 */
import { useEffect, useState } from 'react';

export interface SessionUser {
  id: string;
  email: string;
  tier: 'free' | 'pro';
}

let cached: SessionUser | null | undefined = undefined;
const listeners = new Set<() => void>();
let inflight: Promise<SessionUser | null> | null = null;

async function load(): Promise<SessionUser | null> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' });
      const data = await res.json();
      cached = data?.user ?? null;
    } catch {
      cached = null;
    }
    listeners.forEach((l) => l());
    return cached ?? null;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export function useSessionUser(): SessionUser | null {
  const [user, setUser] = useState<SessionUser | null>(cached ?? null);

  useEffect(() => {
    if (cached === undefined) {
      void load();
    }
    const handler = () => setUser(cached ?? null);
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);

  return user;
}
