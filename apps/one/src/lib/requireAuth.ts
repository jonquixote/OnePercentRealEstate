import { useRouter } from 'next/navigation';

/** Build the login URL that preserves the surface the user was on and the
 *  action they were attempting, so auth can return them to it (plan F3). */
export function buildAuthUrl(intent: string, next?: string): string {
  const dest =
    next ??
    (typeof window !== 'undefined'
      ? window.location.pathname + window.location.search
      : '/');
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
