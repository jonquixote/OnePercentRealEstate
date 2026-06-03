# Wave 7 — auth follow-ups

Wave 7 hardened the Stripe webhook (idempotency table, dead-letter queue, signature check kept) and added a `loginLimiter` to `apps/one/src/lib/rate-limit.ts`. The limiter is **not wired into a login flow yet**, because authentication itself is currently a stub.

## Current state

- `apps/one/src/app/login/page.tsx` is a client-only form that does **nothing** on submit except redirect to `/` after a 1.5s delay. Comments say "Authentication is currently disabled. To re-enable, implement with NextAuth.js."
- `apps/one/src/app/auth/callback/route.ts` is also a stub that immediately redirects to `/`. Comments say "Auth callback disabled — no Supabase auth. To re-enable authentication, implement with NextAuth.js."
- `apps/one/src/app/actions.ts` contains **no** login/signup Server Actions; only data-loading actions (`getProperties`, `getProperty`, `getHudBenchmark`, `updatePropertyRent`).
- Webhook handlers in `apps/one/src/app/api/webhooks/route.ts` already key off Stripe `customer_email` (with `profiles.email`) to resolve a user, so the data model is ready for an email/password or magic-link flow once auth lands.

## What `loginLimiter` is waiting for

When auth lands, take **the path of least friction**:

1. Pick an auth strategy (NextAuth.js, Better-Auth, Auth.js, or a hand-rolled magic-link flow over Postmark).
2. Wire the actual login submit to either:
   - A Server Action in `apps/one/src/app/actions.ts` (preferred — single source of truth), or
   - A route handler at `apps/one/src/app/api/auth/login/route.ts` that the form POSTs to.
3. At the top of that handler, do:

   ```ts
   import { checkRateLimit, loginLimiter } from '@/lib/rate-limit';

   const ip =
     req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
     req.headers.get('x-real-ip') ||
     'unknown';
   const limit = await checkRateLimit(loginLimiter, ip);
   if (!limit.allowed) {
     return new Response(
       JSON.stringify({ error: 'Too many login attempts. Try again later.' }),
       {
         status: 429,
         headers: { 'Retry-After': String(limit.retryAfter ?? 300) },
       }
     );
   }
   ```

   For Server Actions specifically, IP must be pulled via `headers()` from `next/headers`, since Server Actions don't receive a `Request` object directly:

   ```ts
   import { headers } from 'next/headers';

   const h = await headers();
   const ip =
     h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
     h.get('x-real-ip') ||
     'unknown';
   ```

4. Also key the limiter on **email** as well as IP to defend against distributed credential-stuffing:

   ```ts
   await Promise.all([
     checkRateLimit(loginLimiter, `ip:${ip}`),
     checkRateLimit(loginLimiter, `email:${email.toLowerCase()}`),
   ]);
   ```

5. CSRF: Next 16's built-in Server Action origin check is sufficient as long as `next.config.ts` does **not** set `experimental.serverActions.allowedOrigins` to a broader list. As of Wave 7, `next.config.ts` does not configure `experimental.serverActions` at all, so the default same-origin check is active — good. If you later need to allow `two.octavo.press` to call Server Actions on `one.octavo.press` (or vice versa), explicitly allowlist them; don't open it to `*`.

6. After auth lands, delete this file.

## TL;DR for the next agent

`loginLimiter` is defined and exported in `apps/one/src/lib/rate-limit.ts`. The login page is a stub. When you implement real auth, import the limiter and apply it at the top of the login handler before doing any DB / password work. Key on both IP and (lowercased) email.
