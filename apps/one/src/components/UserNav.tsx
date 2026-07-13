'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut, User, Settings, Bookmark, TerminalSquare } from 'lucide-react';

interface Me { id: string; email: string; tier: 'free' | 'pro' }

// Wave 5: session-aware nav backed by /api/auth/me.
export default function UserNav() {
  const [user, setUser] = useState<Me | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    let alive = true;
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => { if (alive) { setUser(d.user ?? null); setLoaded(true); } })
      .catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
    setOpen(false);
    router.refresh();
  };

  if (!loaded) return null;

  if (!user) {
    return (
      <Link
        href="/login"
        className="text-sm font-semibold leading-6 text-haze hover:text-foreground transition-colors"
      >
        Log in <span aria-hidden="true">&rarr;</span>
      </Link>
    );
  }

  const initial = user.email.charAt(0).toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account menu"
        className="flex items-center gap-2"
        title={user.email}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-pass-dim text-[12px] font-bold text-pass">
          {initial}
        </span>
        {user.tier === 'pro' && (
          <span className="rounded-full bg-brass-dim px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-brass">
            pro
          </span>
        )}
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          tabIndex={-1}
          aria-label="Account"
          className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-line bg-card/95 p-2 shadow-[var(--shadow-pop)] backdrop-blur"
        >
          <p className="truncate px-3 py-2 text-sm text-foreground" title={user.email}>
            {user.email}
          </p>
          <div className="my-1 h-px bg-line" />
          <MenuLink href="/account" icon={<User className="h-4 w-4" />}>Account</MenuLink>
          <MenuLink href="/settings" icon={<Settings className="h-4 w-4" />}>Settings</MenuLink>
          <MenuLink href="/shelf" icon={<Bookmark className="h-4 w-4" />}>Saved searches</MenuLink>
          {user.tier === 'pro' && (
            <MenuLink href="https://two.octavo.press" icon={<TerminalSquare className="h-4 w-4" />} external>
              Terminal <span aria-hidden>&rarr;</span>
            </MenuLink>
          )}
          <div className="my-1 h-px bg-line" />
          <button
            type="button"
            onClick={logout}
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-haze transition-colors hover:bg-ink-2 hover:text-foreground"
          >
            <LogOut className="h-4 w-4" /> Log out
          </button>
        </div>
      )}
    </div>
  );
}

function MenuLink({
  href,
  icon,
  external,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  external?: boolean;
  children: React.ReactNode;
}) {
  const cls =
    'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-haze transition-colors hover:bg-ink-2 hover:text-foreground';
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" role="menuitem" className={cls}>
        {icon} {children}
      </a>
    );
  }
  return (
    <Link href={href} role="menuitem" className={cls}>
      {icon} {children}
    </Link>
  );
}
