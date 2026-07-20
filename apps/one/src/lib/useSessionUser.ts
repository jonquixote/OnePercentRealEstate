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
  stripeCustomerId: string | null;
}

let cached: SessionUser | null | undefined = undefined;
const listeners = new Set<() => void>();
let inflight: Promise<SessionUser | null> | null = null;
let loaded = false;

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
    loaded = true;
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
    // After a Stripe checkout completes, the webhook flips the user's tier in
    // `profiles`, but the session JWT was baked at login and is now stale. The
    // checkout success redirect carries `?upgrade_success=true`; refresh the
    // cookie from the DB so entitlements + the billing link update without a
    // manual re-login.
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('upgrade_success') === 'true') {
        // The Stripe webhook flips the user's tier in `profiles` asynchronously.
        // Poll /api/auth/refresh a few times (≤5 × 800ms) so we don't cache a
        // stale `free` tier if the webhook hasn't landed yet. Stop early once the
        // refreshed session shows `pro`.
        let attempts = 0;
        const tryRefresh = async (): Promise<void> => {
          try {
            await fetch('/api/auth/refresh', { cache: 'no-store' });
            // /api/auth/refresh only re-issues the cookie; re-read /api/auth/me
            // so `cached` reflects the DB tier before we check it. Without this,
            // the early-stop below reads the stale pre-refresh value.
            await load();
            if (cached?.tier === 'pro') {
              notifyAuthChanged();
              return;
            }
          } catch {
            /* ignore network errors; fall through to retry/settle */
          }
          if (++attempts < 5) {
            setTimeout(tryRefresh, 800);
          } else {
            notifyAuthChanged();
          }
        };
        void tryRefresh();

        // Strip the param so a manual refresh doesn't re-trigger the flow.
        params.delete('upgrade_success');
        params.delete('session_id');
        const newUrl = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`;
        window.history.replaceState({}, '', newUrl);
      }
    }
    const handler = () => setUser(cached ?? null);
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);

  return user;
}

/** True once the initial /api/auth/me load has settled (success or fail). */
export function useSessionLoaded(): boolean {
  const [isLoaded, setIsLoaded] = useState(loaded);
  useEffect(() => {
    if (loaded) {
      setIsLoaded(true);
      return;
    }
    const handler = () => setIsLoaded(true);
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);
  return isLoaded;
}
