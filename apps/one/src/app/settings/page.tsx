'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';

interface SessionUser { id: string; email: string; tier: 'free' | 'pro'; }

export default function SettingsPage() {
    const router = useRouter();
    const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
    const [portalLoading, setPortalLoading] = useState(false);

    useEffect(() => {
        fetch('/api/auth/me')
            .then(r => r.json())
            .then(d => setUser(d.user ?? null))
            .catch(() => setUser(null));
    }, []);

    const handleManageSubscription = async () => {
        setPortalLoading(true);
        try {
            const res = await fetch('/api/checkout/portal', { method: 'POST' });
            const data = await res.json();
            if (data.url) window.location.href = data.url;
        } catch { /* ignore */ }
        setPortalLoading(false);
    };

    return (
        <div style={{ background: 'var(--ink)', color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>
            <Header />
            <div className="mx-auto max-w-3xl px-6 py-14">
                <h1 style={{ font: '400 var(--display-2)/1.1 var(--font-display)' }}>
                    Account Settings
                </h1>

                {/* Profile Section */}
                <div className="mt-10 rounded-[var(--r-panel)]" style={{ background: 'var(--ink-panel)', border: '1px solid var(--line)' }}>
                    <div className="px-6 py-5" style={{ borderBottom: '1px solid var(--line)' }}>
                        <h3 className="prov prov--est">Profile</h3>
                        <p className="mt-1 text-[13px]" style={{ color: 'var(--haze)' }}>Your personal information.</p>
                    </div>
                    <div className="px-6 py-5">
                        <div>
                            <label className="block text-[13px] font-medium" style={{ color: 'var(--haze)' }}>Email Address</label>
                            <div className="mt-1 flex rounded-md">
                                <input
                                    type="text"
                                    disabled
                                    value={user?.email ?? 'Not signed in'}
                                    className="block w-full rounded-md border px-3 py-2 text-[14px] disabled:cursor-not-allowed"
                                    style={{ borderColor: 'var(--line)', background: 'var(--ink-2)', color: 'var(--mute)' }}
                                />
                            </div>
                        </div>
                        {!user && (
                            <p className="mt-2 text-[12px]" style={{ color: 'var(--mute)' }}>
                                <Link href="/login" style={{ color: 'var(--pass-hi)' }}>Sign in</Link> to manage your account settings.
                            </p>
                        )}
                        {user && (
                            <p className="mt-2 text-[12px]" style={{ color: 'var(--mute)' }}>
                                Email changes are managed through your Stripe billing portal.
                            </p>
                        )}
                    </div>
                </div>

                {/* Subscription Section */}
                <div className="mt-6 rounded-[var(--r-panel)]" style={{ background: 'var(--ink-panel)', border: '1px solid var(--line)' }}>
                    <div className="px-6 py-5" style={{ borderBottom: '1px solid var(--line)' }}>
                        <h3 className="prov prov--est">Subscription</h3>
                        <p className="mt-1 text-[13px]" style={{ color: 'var(--haze)' }}>Manage your plan and billing.</p>
                    </div>
                    <div className="px-6 py-5">
                        <div className="rounded-md p-4" style={{ background: user?.tier === 'pro' ? 'var(--pass-dim)' : 'var(--ink-2)', border: '1px solid var(--line)' }}>
                            <div className="flex items-center gap-3">
                                <div>
                                    <h3 className="text-[14px] font-semibold" style={{ color: user?.tier === 'pro' ? 'var(--pass-hi)' : 'var(--text)' }}>
                                        {user ? `${user.tier === 'pro' ? 'Pro' : 'Free'} plan` : 'Not signed in'}
                                    </h3>
                                    <p className="mt-1 text-[13px]" style={{ color: 'var(--haze)' }}>
                                        {user?.tier === 'pro'
                                            ? 'You have full access to all features.'
                                            : user ? 'Upgrade to Pro for unlimited saves and advanced metrics.'
                                            : 'Sign in to view your subscription.'}
                                    </p>
                                </div>
                            </div>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-3">
                            {user?.tier === 'pro' ? (
                                <button
                                    onClick={handleManageSubscription}
                                    disabled={portalLoading}
                                    className="inline-flex items-center gap-2 rounded-full px-5 py-2 text-[13px] font-semibold transition-colors disabled:opacity-50"
                                    style={{ background: 'var(--pass)', color: '#fff' }}
                                >
                                    {portalLoading ? <><Loader2 className="h-4 w-4 animate-spin" />Loading…</> : 'Manage Subscription'}
                                </button>
                            ) : (
                                <button
                                    onClick={() => router.push('/pricing')}
                                    className="rounded-full px-5 py-2 text-[13px] font-semibold transition-colors"
                                    style={{ background: 'var(--pass)', color: '#fff' }}
                                >
                                    {user ? 'Upgrade to Pro' : 'View Pricing'}
                                </button>
                            )}
                            <button
                                onClick={() => router.push('/')}
                                className="rounded-full border px-5 py-2 text-[13px] font-semibold transition-colors"
                                style={{ borderColor: 'var(--line)', color: 'var(--haze)' }}
                            >
                                Back to Dashboard
                            </button>
                        </div>
                    </div>
                </div>

                {/* Notifications Section */}
                {user && (
                    <div className="mt-6 rounded-[var(--r-panel)]" style={{ background: 'var(--ink-panel)', border: '1px solid var(--line)' }}>
                        <div className="px-6 py-5" style={{ borderBottom: '1px solid var(--line)' }}>
                            <h3 className="prov prov--est">Notifications</h3>
                            <p className="mt-1 text-[13px]" style={{ color: 'var(--haze)' }}>Control how we contact you about new deals.</p>
                        </div>
                        <div className="px-6 py-5 space-y-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-[14px] font-medium">Email alerts</p>
                                    <p className="text-[12px]" style={{ color: 'var(--mute)' }}>Get notified when new properties match your watchlists</p>
                                </div>
                                <span className="prov prov--est">Coming soon</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
