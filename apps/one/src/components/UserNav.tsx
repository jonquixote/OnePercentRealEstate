'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ThemeToggle } from '@oper/primitives';

interface Me { id: string; email: string; tier: 'free' | 'pro' }

// Wave 5: session-aware nav backed by /api/auth/me.
export default function UserNav() {
    const [user, setUser] = useState<Me | null>(null);
    const [loaded, setLoaded] = useState(false);
    const router = useRouter();

    useEffect(() => {
        let alive = true;
        fetch('/api/auth/me')
            .then((r) => r.json())
            .then((d) => { if (alive) { setUser(d.user ?? null); setLoaded(true); } })
            .catch(() => { if (alive) setLoaded(true); });
        return () => { alive = false; };
    }, []);

    const logout = async () => {
        await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
        setUser(null);
        router.refresh();
    };

    return (
        <div className="flex items-center gap-3">
            <ThemeToggle />
            {!loaded ? null : user ? (
                <div className="flex items-center gap-3">
                    <span className="hidden sm:inline text-sm text-haze" title={user.email}>
                        {user.email.split('@')[0]}
                        {user.tier === 'pro' && <span className="ml-1.5 rounded bg-brass px-1.5 py-0.5 text-[10px] font-bold text-zinc-950">PRO</span>}
                    </span>
                    <button
                        onClick={logout}
                        className="text-sm font-semibold leading-6 text-white hover:text-emerald-400 transition-colors"
                    >
                        Log out
                    </button>
                </div>
            ) : (
                <Link
                    href="/login"
                    className="text-sm font-semibold leading-6 text-white hover:text-emerald-400 transition-colors flex items-center"
                >
                    Log in <span aria-hidden="true" className="ml-1">&rarr;</span>
                </Link>
            )}
        </div>
    );
}
