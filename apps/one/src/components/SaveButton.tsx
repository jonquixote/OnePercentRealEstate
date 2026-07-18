'use client';

import { useState } from 'react';
import Link from 'next/link';

interface Props {
  listingId: string | number;
  initialSaved?: boolean;
}

/**
 * Heart save toggle for a single listing. Optimistic local state; POST to add,
 * DELETE to remove. Signed-out users get a link to /account?next=… so saving
 * survives sign-in. Inline SVG heart uses var(--brass) when saved.
 */
export default function SaveButton({ listingId, initialSaved = false }: Props) {
  const [saved, setSaved] = useState(initialSaved);
  const [busy, setBusy] = useState(false);
  const [signedOut, setSignedOut] = useState(false);

  const lid = String(listingId);

  const toggle = async () => {
    setBusy(true);
    const next = !saved;
    setSaved(next); // optimistic
    try {
      if (next) {
        const res = await fetch('/api/saved-properties', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ listingId: lid }),
        });
        if (res.status === 401) {
          setSaved(false);
          setSignedOut(true); // signed-out -> show sign-in link
        } else if (!res.ok) {
          setSaved(!next);
        }
      } else {
        const res = await fetch(`/api/saved-properties?listingId=${lid}`, { method: 'DELETE' });
        if (res.status === 401) {
          setSaved(true);
          setSignedOut(true);
        } else if (!res.ok) {
          setSaved(!next);
        }
      }
    } catch {
      setSaved(!next); // revert on network error
    } finally {
      setBusy(false);
    }
  };

  if (signedOut) return <SaveLink listingId={lid} />;

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      title={saved ? 'Remove from saved' : 'Save this property'}
      aria-label={saved ? 'Remove from saved properties' : 'Save this property'}
      aria-pressed={saved}
      className="flex items-center justify-center rounded-full border transition-colors disabled:opacity-50"
      style={{
        borderColor: saved ? 'var(--brass)' : 'var(--line)',
        color: saved ? 'var(--brass)' : 'var(--haze)',
        background: 'var(--ink-panel)',
        width: '36px',
        height: '36px',
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill={saved ? 'var(--brass)' : 'none'}
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    </button>
  );
}

export function SaveLink({ listingId }: { listingId: string | number }) {
  const lid = String(listingId);
  return (
    <Link
      href={`/account?next=/property/${lid}`}
      title="Sign in to save"
      aria-label="Sign in to save this property"
      className="flex items-center justify-center rounded-full border transition-colors"
      style={{
        borderColor: 'var(--line)',
        color: 'var(--haze)',
        background: 'var(--ink-panel)',
        width: '36px',
        height: '36px',
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    </Link>
  );
}
