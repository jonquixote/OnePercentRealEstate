'use client';

import { useState } from 'react';
import { useSessionUser } from '@/lib/useSessionUser';

const USER_ID_STORAGE_KEY = 'oper:user_id';

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

/**
 * Returns the identity to scope saved searches / watches against: the real
 * account id when a session exists, otherwise a stable anonymous UUID kept in
 * localStorage. This is what makes saved data claimed on login instantly
 * visible to the same browser.
 */
export function useLocalUserId(): string | null {
  const session = useSessionUser();
  const [anonId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const existing = window.localStorage.getItem(USER_ID_STORAGE_KEY);
      if (existing) return existing;
      const fresh = generateUuid();
      window.localStorage.setItem(USER_ID_STORAGE_KEY, fresh);
      return fresh;
    } catch {
      // Private browsing / storage disabled — ephemeral id so the UI works.
      return generateUuid();
    }
  });
  return session?.id ?? anonId;
}
