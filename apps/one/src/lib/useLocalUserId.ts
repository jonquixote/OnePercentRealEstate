'use client';

import { useState } from 'react';
import { useSessionUser } from '@/lib/useSessionUser';

const USER_ID_STORAGE_KEY = 'oper:user_id';

// Module-scoped per-tab fallback so every hook instance (and the login page)
// shares ONE anonymous id when storage is unavailable, instead of minting a
// new UUID per caller.
let fallbackAnonId: string | null = null;

export function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // RFC 4122 v4 fallback for older runtimes.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Safe read of the persisted anonymous id — never throws on storage errors. */
export function getLocalUserId(): string | null {
  if (typeof window === 'undefined') return fallbackAnonId;
  try {
    const existing = window.localStorage.getItem(USER_ID_STORAGE_KEY);
    if (existing) return existing;
  } catch {
    /* storage disabled */
  }
  return fallbackAnonId;
}

/** Returns a stable anonymous id, persisting a fresh one if needed. */
export function ensureLocalUserId(): string {
  const existing = getLocalUserId();
  if (existing) return existing;
  const fresh = generateUuid();
  fallbackAnonId = fresh;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(USER_ID_STORAGE_KEY, fresh);
    } catch {
      /* storage disabled — keep the module-scoped fallback */
    }
  }
  return fresh;
}

/**
 * Returns the identity to scope saved searches / watches against: the real
 * account id when a session exists, otherwise a stable anonymous UUID kept in
 * localStorage. This is what makes saved data claimed on login instantly
 * visible to the same browser.
 */
export function useLocalUserId(): string | null {
  const session = useSessionUser();
  const [anonId] = useState<string | null>(() => ensureLocalUserId());
  return session?.id ?? anonId;
}
