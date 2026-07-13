'use client';

/**
 * Lightweight client-side session hook. Fetches `/api/auth/me` once (lazily,
 * cached at module scope) and re-reads on the `oper:auth` window event, which
 * `notifyAuthChanged()` dispatches after a successful login/signup.
 *
 * This lets identity-aware components (e.g. SavedSearches) switch from the
 * anonymous localStorage UUID to the real account id the moment a session
 * exists, without each component re-implementing its own /me fetch.
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

/** Call after a successful login/signup so all consumers refresh. */
export function notifyAuthChanged(): void {
  void load();
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
