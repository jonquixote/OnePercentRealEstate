# One Login Everywhere — Cross-Domain Session, Terminal Recognizes Pro

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A paying Pro user is currently invisible to the terminal. The session cookie (`oper_session`) is set host-only on `one.octavo.press`, so `two.octavo.press` never receives it — every terminal request is anonymous, `/api/layouts` always 401s, the Pro filter bar never unlocks, and the product's flagship Pro surface cannot recognize the people who pay for it. This plan scopes the cookie to `.octavo.press`, lets login round-trip across subdomains safely, surfaces session state in the terminal header, deletes the dead pre-auth SavedSearches prototype (three failed 501 requests on every page), and lets the report-only CSP pass Stripe.

**Architecture:** One env var (`SESSION_COOKIE_DOMAIN=.octavo.press`) threads into `sessionCookieOptions()` in BOTH apps' `lib/auth.ts` (they are deliberate mirrors — keep them identical). Because two's nginx vhost falls through `/api/*` to apps/one, `two.octavo.press/api/auth/me` already reaches one's session endpoint — the domain cookie alone lights up two's entire session layer (`useSessionUser`, `getSessionUser` in layouts). Login's `next` param gains an absolute-URL allowlist so `one.octavo.press/login?next=https://two.octavo.press/` round-trips.

**Tech Stack:** Next 16 App Router (apps/one + apps/two), jose HS256 session JWT, nginx edge (`ops/nginx/sites/*`), Vitest (jsdom pragma for TSX).

## Global Constraints

- **`profiles.subscription_tier` is written ONLY by the Stripe webhook path.** Nothing in this plan writes tier — the terminal only *reads* it via the session.
- **Cookie attributes stay `httpOnly, sameSite: 'lax', secure (prod), path: '/'`.** The ONLY addition is `domain`, and ONLY when `SESSION_COOKIE_DOMAIN` is set — unset (local dev, tests) behaves exactly as today (host-only).
- **`next` redirect allowlist is exact-host:** `one.octavo.press` and `two.octavo.press` over https only. Anything else — other hosts, subdomain tricks (`two.octavo.press.evil.com`), protocol-relative `//`, non-http(s) schemes — falls back to `/`. No suffix matching.
- **apps/one and apps/two `lib/auth.ts` stay mirrors.** Any change to one is applied verbatim to the other (the files say so in their headers).
- **Never delete listing or user data.** The SavedSearches *UI component and its 501 API route* are removed; the `saved_searches` table and the digest worker that reads it are untouched.
- **Design language:** two is the dark zinc terminal idiom (font-mono, `text-zinc-*`, amber for upsell); one is eggshell tokens. No cross-app imports.
- **Tests:** `pnpm --filter @oper/one test`, `pnpm --filter @oper/two test`; typecheck via `pnpm --filter <app> exec tsc --noEmit`.

## Current State (verified 2026-07-19 on prod + code)

- `apps/one/src/lib/auth.ts:72-80` `sessionCookieOptions()` — no `domain` key. `apps/two/src/lib/auth.ts` mirrors it (same `SESSION_COOKIE = 'oper_session'`).
- Cookie consumers on one: `/api/auth/login`, `/api/auth/signup`, `/api/auth/refresh` (sets), `/api/auth/logout` (clears — must clear with the SAME attributes incl. domain or the old cookie lingers), `getSessionUser()` (reads).
- two's `useSessionUser` (`apps/two/src/lib/useSessionUser.ts`) fetches `/api/auth/me`; two's nginx vhost (`ops/nginx/sites/two.octavo.press`) routes `/api/*` to apps/one:3001 **except** exact-match blocks (`= /api/layouts`, `= /api/screens`, `= /api/screen-alerts`, `= /api/market-series`, `= /api/healthz`, `= /api/watchlists` → 3002). So `/api/auth/me` on two already reaches one's handler — it just never sees a cookie today.
- `safeNextPath` (`apps/one/src/app/login/page.tsx:19-23`) rejects every absolute URL — correct today, blocks cross-app round-trip tomorrow.
- Terminal header (`apps/two/src/app/(terminal)/layout.tsx`) has no session affordance at all: anon and authed render identically; `isPro` drives only the filter bar.
- `SavedSearches` (`apps/one/src/components/SavedSearches.tsx`) is a pre-session-auth prototype using a random localStorage `oper:user_id`; its API (`apps/one/src/app/api/saved-searches/route.ts`) deliberately 501s in production. Every search-page load fires 3 failing requests. Superseded by watchlists + the shelf.
- CSP is **Report-Only**, set in `apps/one/next.config.ts` (~line 59). Console logs violations for `https://js.stripe.com` (script-src + frame-src) on /pricing — must be allowed before CSP is ever enforced.

## File Structure

| File | Responsibility |
|---|---|
| `apps/one/src/lib/auth.ts` (modify) | `sessionCookieOptions()` honors `SESSION_COOKIE_DOMAIN`. |
| `apps/two/src/lib/auth.ts` (modify) | Identical change (mirror). |
| `apps/one/src/app/api/auth/logout/route.ts` (modify if needed) | Clear cookie with the same options object (domain included). |
| `apps/one/src/app/login/page.tsx` (modify) | `safeNextPath` allowlists the two production hosts. |
| `apps/two/src/app/(terminal)/layout.tsx` (modify) | Header session chip: Sign in → / email + tier. |
| `apps/one/src/app/search/page.tsx` + `apps/one/src/components/SavedSearches.tsx` + `apps/one/src/app/api/saved-searches/route.ts` (delete/modify) | Remove the dead prototype. |
| `apps/one/next.config.ts` (modify) | CSP-Report-Only allows js.stripe.com. |
| `documentation/infrastructure/environment-variables.md` (modify) | Document `SESSION_COOKIE_DOMAIN`. |

---

## Task 1: Cookie domain from env (both auth mirrors)

**Files:** modify `apps/one/src/lib/auth.ts`, `apps/two/src/lib/auth.ts`; tests `apps/one/src/lib/auth.test.ts` (create or extend), mirror test in two if two has one.

- [ ] **Step 1: Failing tests** (`apps/one/src/lib/auth.test.ts`):

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { sessionCookieOptions } from './auth';

describe('sessionCookieOptions', () => {
  const OLD = process.env.SESSION_COOKIE_DOMAIN;
  afterEach(() => {
    if (OLD === undefined) delete process.env.SESSION_COOKIE_DOMAIN;
    else process.env.SESSION_COOKIE_DOMAIN = OLD;
  });

  it('omits domain when SESSION_COOKIE_DOMAIN is unset', () => {
    delete process.env.SESSION_COOKIE_DOMAIN;
    expect(sessionCookieOptions()).not.toHaveProperty('domain');
  });

  it('sets domain when SESSION_COOKIE_DOMAIN is set', () => {
    process.env.SESSION_COOKIE_DOMAIN = '.octavo.press';
    expect(sessionCookieOptions().domain).toBe('.octavo.press');
  });

  it('keeps the existing attributes', () => {
    delete process.env.SESSION_COOKIE_DOMAIN;
    expect(sessionCookieOptions()).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `pnpm --filter @oper/one test src/lib/auth.test.ts` (domain test fails).
- [ ] **Step 3: Implement** in `apps/one/src/lib/auth.ts` (and verbatim in `apps/two/src/lib/auth.ts`):

```ts
export function sessionCookieOptions() {
  // SESSION_COOKIE_DOMAIN (prod: ".octavo.press") shares the session across
  // one.octavo.press and two.octavo.press. Unset (dev/tests) = host-only,
  // exactly the pre-2026-07-20 behavior.
  const domain = process.env.SESSION_COOKIE_DOMAIN;
  return {
    httpOnly: true as const,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_S,
    ...(domain ? { domain } : null),
  };
}
```

- [ ] **Step 4: Audit every cookie *clear* site** — grep `SESSION_COOKIE` across `apps/one/src/app/api/auth/`; the logout route must delete with the SAME options (a delete without `domain` cannot remove a domain cookie). If it clears via `jar.delete(SESSION_COOKIE)` change it to `jar.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 })`.
- [ ] **Step 5: GREEN + typecheck both apps; commit** — `feat(auth): SESSION_COOKIE_DOMAIN scopes the session cookie across octavo.press subdomains`

## Task 2: Cross-app `next` redirect allowlist

**Files:** modify `apps/one/src/app/login/page.tsx`; extend its test file (or create `apps/one/src/app/login/safe-next.test.ts` by exporting the helper).

- [ ] **Step 1: Export + failing tests.** Move `safeNextPath` to an exported function (same file). Tests:

```ts
import { describe, it, expect } from 'vitest';
import { safeNextPath } from './page';

describe('safeNextPath', () => {
  it('keeps relative paths', () => expect(safeNextPath('/welcome')).toBe('/welcome'));
  it('rejects protocol-relative', () => expect(safeNextPath('//evil.com')).toBe('/'));
  it('allows the two production hosts over https', () => {
    expect(safeNextPath('https://two.octavo.press/')).toBe('https://two.octavo.press/');
    expect(safeNextPath('https://one.octavo.press/shelf')).toBe('https://one.octavo.press/shelf');
  });
  it('rejects other hosts and suffix tricks', () => {
    expect(safeNextPath('https://two.octavo.press.evil.com/')).toBe('/');
    expect(safeNextPath('https://evil.com/')).toBe('/');
    expect(safeNextPath('http://two.octavo.press/')).toBe('/'); // https only
    expect(safeNextPath('javascript:alert(1)')).toBe('/');
  });
});
```

- [ ] **Step 2: RED → implement → GREEN:**

```ts
const NEXT_HOST_ALLOWLIST = new Set(['one.octavo.press', 'two.octavo.press']);

export function safeNextPath(next: string | null): string {
  if (!next) return '/';
  if (next.startsWith('//')) return '/';
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(next)) {
    // Absolute URL: allow ONLY https to our two production hosts (exact match).
    try {
      const url = new URL(next);
      if (url.protocol === 'https:' && NEXT_HOST_ALLOWLIST.has(url.hostname)) return next;
    } catch {
      /* fall through to reject */
    }
    return '/';
  }
  return next;
}
```

- [ ] **Step 3: Full one suite + typecheck; commit** — `feat(auth): login next param round-trips to two.octavo.press (exact-host allowlist)`

## Task 3: Terminal header session chip

**Files:** modify `apps/two/src/app/(terminal)/layout.tsx`; test `apps/two/src/components/SessionChip.test.tsx` (create `apps/two/src/components/SessionChip.tsx`).

- [ ] **Step 1: Failing component test** (jsdom pragma, mock `useSessionUser`):

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockSession = vi.hoisted(() => ({ value: null as null | { email: string; tier: string } }));
vi.mock('@/lib/useSessionUser', () => ({ useSessionUser: () => mockSession.value }));

import { SessionChip } from './SessionChip';

describe('SessionChip', () => {
  it('anon: sign-in link to one.octavo.press with next back to the terminal', () => {
    mockSession.value = null;
    render(<SessionChip />);
    const a = screen.getByRole('link', { name: /sign in/i });
    expect(a.getAttribute('href')).toBe(
      'https://one.octavo.press/login?next=https%3A%2F%2Ftwo.octavo.press%2F',
    );
  });

  it('free user: email + FREE badge + pricing link', () => {
    mockSession.value = { email: 'a@b.c', tier: 'free' };
    render(<SessionChip />);
    expect(screen.getByText('a@b.c')).toBeTruthy();
    expect(screen.getByText('FREE')).toBeTruthy();
    expect(screen.getByRole('link', { name: /go pro/i })).toBeTruthy();
  });

  it('pro user: email + PRO badge, no pricing link', () => {
    mockSession.value = { email: 'p@b.c', tier: 'pro' };
    render(<SessionChip />);
    expect(screen.getByText('PRO')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /go pro/i })).toBeNull();
  });
});
```

- [ ] **Step 2: RED → implement `SessionChip.tsx`:**

```tsx
"use client";

import * as React from "react";
import { useSessionUser } from "@/lib/useSessionUser";

const SIGN_IN_HREF =
  "https://one.octavo.press/login?next=" +
  encodeURIComponent("https://two.octavo.press/");

/** Header session state: anon → sign-in link; authed → email + tier badge. */
export function SessionChip() {
  const session = useSessionUser();
  if (!session) {
    return (
      <a
        href={SIGN_IN_HREF}
        className="rounded-sm border border-zinc-700 px-2 py-0.5 font-mono text-[11px] uppercase tracking-widest text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
      >
        Sign in →
      </a>
    );
  }
  const pro = session.tier === "pro";
  return (
    <span className="flex items-center gap-2 font-mono text-[11px]">
      <span className="max-w-[16ch] truncate text-zinc-400">{session.email}</span>
      <span
        className={
          pro
            ? "rounded-sm border border-primary/40 bg-primary/10 px-1.5 py-0.5 uppercase tracking-widest text-primary"
            : "rounded-sm border border-zinc-700 px-1.5 py-0.5 uppercase tracking-widest text-zinc-400"
        }
      >
        {pro ? "PRO" : "FREE"}
      </span>
      {!pro && (
        <a
          href="https://one.octavo.press/pricing?from=terminal"
          className="text-amber-200 underline underline-offset-2 hover:text-amber-50"
        >
          Go Pro
        </a>
      )}
    </span>
  );
}
```

- [ ] **Step 3: Mount it** in `(terminal)/layout.tsx`'s top-bar right cluster (next to `ThemeToggle`): `<SessionChip />`. GREEN.
- [ ] **Step 4: two suite + typecheck; commit** — `feat(two): terminal header shows session + tier, sign-in round-trips through one`

## Task 4: Remove the dead SavedSearches prototype

**Files:** delete `apps/one/src/components/SavedSearches.tsx` + `apps/one/src/app/api/saved-searches/route.ts` (and its test file if any); modify `apps/one/src/app/search/page.tsx` (unmount); update `apps/one/src/app/search/page.test.tsx` if it references it.

- [ ] **Step 1:** Grep first: `grep -rn "SavedSearches\|saved-searches" apps/one/src` — remove every mount/import. **Do NOT touch** `apps/worker/src/digest.ts`, the `saved_searches` table, or `/api/unsubscribe` (the digest leg still reads them).
- [ ] **Step 2:** Delete the component + route files. If the search page had layout space reserved for it, let the remaining content flow (no empty placeholder box).
- [ ] **Step 3:** Full one suite + typecheck (removal breaks imports loudly if anything was missed); commit — `chore(one): remove pre-auth SavedSearches prototype (501 in prod since Wave 8; watchlists + shelf superseded it)`

## Task 5: CSP passes Stripe

**Files:** modify `apps/one/next.config.ts`.

- [ ] **Step 1:** In the `Content-Security-Policy-Report-Only` header value: append `https://js.stripe.com` to `script-src`, and add a `frame-src 'self' https://js.stripe.com` directive (there is currently no `frame-src`, so `default-src 'self'` is the fallback that fires). Touch nothing else in the policy.
- [ ] **Step 2:** `pnpm --filter @oper/one build` locally to confirm config parses; commit — `fix(one): CSP report-only allows js.stripe.com (script + frame) ahead of enforcement`

## Task 6: Deploy + cross-domain proof

- [ ] **Step 1:** Add `SESSION_COOKIE_DOMAIN=.octavo.press` to the server's `.env` (the value is not a secret) and document it in `documentation/infrastructure/environment-variables.md`. Regen env + deploy: `bash ops/systemd/deploy-systemd.sh app two`.
- [ ] **Step 2: Proof (browser):** log in on one.octavo.press → visit two.octavo.press → header shows the email chip (no sign-in link); `GET https://two.octavo.press/api/layouts` returns 200 with `limits` (was 401). Log out on one → two shows "Sign in →" again after reload (single logout kills both).
- [ ] **Step 3: Proof (redirect):** anon visit `https://one.octavo.press/login?next=https://two.octavo.press/` → after login the browser lands on two, already authenticated.
- [ ] **Step 4: Proof (CSP + cleanup):** /pricing console shows no `js.stripe.com` CSP reports; /search fires zero `/api/saved-searches` requests.
- [ ] **Step 5: No-regression:** one's suites green in CI; `curl -s -o /dev/null -w "%{http_code}" https://one.octavo.press/api/auth/me` (no cookie) still 401/200-null per contract; existing logged-in users on one keep working (old host-only cookie remains valid until refresh re-issues the domain cookie — verify by checking `Set-Cookie` on `/api/auth/refresh` includes `Domain=.octavo.press`).

## Self-Review

**Spec coverage:** cookie crosses subdomains behind one env var, unset = today's behavior (T1) · login round-trips to two under an exact-host https allowlist (T2) · terminal surfaces session + tier with sign-in/Go-Pro affordances (T3) · dead 501 prototype removed without touching digest data (T4) · CSP unblocks Stripe pre-enforcement (T5) · deploy + logout/refresh/redirect proofs (T6). Covered.

**Placeholder scan:** every step names exact files with complete code or exact greps; the only located-at-execution item (logout clear-site audit) has the exact replacement pattern spelled out.

**Type consistency:** `sessionCookieOptions()` return shape only gains optional `domain` (spread-null pattern keeps the type additive); `SessionChip` consumes two's existing `useSessionUser` shape `{ email, tier }`; no cross-app imports introduced.
