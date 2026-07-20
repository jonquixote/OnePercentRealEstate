"use client";

import * as React from "react";
import { useSessionUser } from "@/lib/useSessionUser";

const ONE_URL = process.env.NEXT_PUBLIC_ONE_URL || "https://one.octavo.press";
const TWO_URL = process.env.NEXT_PUBLIC_TWO_URL || "https://two.octavo.press";

const SIGN_IN_HREF =
  ONE_URL + "/login?next=" + encodeURIComponent(TWO_URL + "/");

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
          href={ONE_URL + "/pricing?from=terminal"}
          className="text-amber-200 underline underline-offset-2 hover:text-amber-50"
        >
          Go Pro
        </a>
      )}
    </span>
  );
}
