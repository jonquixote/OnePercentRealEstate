import { useRouter } from 'next/navigation';

/** Normalize a post-login return path. Rejects protocol-relative
 *  (`//evil.example`) and absolute (`https://...`) URLs so `router.push`
 *  cannot be steered to an external origin (open-redirect). Falls back to the
 *  current path when `next` is absent or unsafe. */
function safeNext(next?: string): string {
  const fallback =
    typeof window !== 'undefined'
      ? window.location.pathname + window.location.search
      : '/';
  if (!next) return fallback;
  if (next.startsWith('//') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(next)) {
    return fallback;
  }
  return next;
}

/** Build the login URL that preserves the surface the user was on and the
 *  action they were attempting, so auth can return them to it (plan F3). */
export function buildAuthUrl(intent: string, next?: string): string {
  const dest = safeNext(next);
  return `/login?next=${encodeURIComponent(dest)}&intent=${encodeURIComponent(intent)}`;
}

/** Route the user to login, carrying the return destination + intent. */
export function requireAuth(
  router: ReturnType<typeof useRouter>,
  intent: string,
  next?: string,
) {
  router.push(buildAuthUrl(intent, next));
}
