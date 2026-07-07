'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';

// Wave 5: real credentials auth against /api/auth/{login,signup}.
export default function LoginPage() {
    const [mode, setMode] = useState<'login' | 'signup'>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
    const router = useRouter();

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setMessage(null);
        try {
            const res = await fetch(`/api/auth/${mode}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMessage({ type: 'error', text: data.error ?? 'Something went wrong' });
                return;
            }
            setMessage({ type: 'success', text: mode === 'signup' ? 'Account created — welcome.' : 'Welcome back.' });
            router.push('/');
            router.refresh();
        } catch {
            setMessage({ type: 'error', text: 'Network error — try again' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-ink py-12 sm:px-6 lg:px-8">
            <div className="sm:mx-auto sm:w-full sm:max-w-md">
                <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-white">
                    {mode === 'login' ? 'Welcome back' : 'Create your account'}
                </h2>
                <p className="mt-2 text-center text-sm text-haze">
                    Watchlists, saved searches, and price-cut alerts
                </p>
            </div>

            <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                <div className="bg-ink-panel border border-line py-8 px-4 shadow sm:rounded-xl sm:px-10">
                    <form className="space-y-6" onSubmit={handleAuth}>
                        <div>
                            <label htmlFor="email" className="block text-sm font-medium text-haze">
                                Email address
                            </label>
                            <input
                                id="email"
                                type="email"
                                autoComplete="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="mt-1 block w-full rounded-md border border-line bg-white/[0.04] px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-pass"
                            />
                        </div>
                        <div>
                            <label htmlFor="password" className="block text-sm font-medium text-haze">
                                Password {mode === 'signup' && <span className="text-zinc-500">(8+ characters)</span>}
                            </label>
                            <input
                                id="password"
                                type="password"
                                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                                required
                                minLength={8}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="mt-1 block w-full rounded-md border border-line bg-white/[0.04] px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-pass"
                            />
                        </div>

                        {message && (
                            <p
                                role="alert"
                                className={`text-sm ${message.type === 'error' ? 'text-rose-400' : 'text-pass-hi'}`}
                            >
                                {message.text}
                            </p>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="flex w-full items-center justify-center gap-2 rounded-md bg-pass px-4 py-2 font-semibold text-white transition-colors hover:bg-pass-hi disabled:opacity-60"
                        >
                            {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                            {mode === 'login' ? 'Log in' : 'Sign up'}
                        </button>
                    </form>

                    <div className="mt-6 text-center text-sm text-haze">
                        {mode === 'login' ? (
                            <>
                                New here?{' '}
                                <button onClick={() => { setMode('signup'); setMessage(null); }} className="font-semibold text-pass-hi hover:underline">
                                    Create an account
                                </button>
                            </>
                        ) : (
                            <>
                                Already have an account?{' '}
                                <button onClick={() => { setMode('login'); setMessage(null); }} className="font-semibold text-pass-hi hover:underline">
                                    Log in
                                </button>
                            </>
                        )}
                    </div>
                    <p className="mt-4 text-center text-xs text-zinc-500">
                        <Link href="/" className="hover:underline">← back to the map</Link>
                    </p>
                </div>
            </div>
        </div>
    );
}
