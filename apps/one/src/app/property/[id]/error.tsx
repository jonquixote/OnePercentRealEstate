'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function PropertyError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    useEffect(() => {
        console.error(error);
    }, [error]);

    return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 p-4" style={{ background: 'var(--ink)' }}>
            <h2 style={{ font: '400 var(--title)/1.2 var(--font-display)', color: 'var(--text)' }}>Could not load this property</h2>
            <p className="text-sm text-center max-w-md" style={{ color: 'var(--haze)' }}>
                {error.message || 'An unexpected error occurred while loading the property page.'}
            </p>
            <div className="flex gap-3 mt-2">
                <button
                    onClick={() => reset()}
                    className="rounded-full px-5 py-2.5 text-sm font-semibold transition-colors"
                    style={{ background: 'var(--pass)', color: '#fff' }}
                >
                    Try again
                </button>
                <Link
                    href="/"
                    className="rounded-full border px-5 py-2.5 text-sm font-semibold transition-colors"
                    style={{ borderColor: 'var(--line)', color: 'var(--haze)' }}
                >
                    Back to dashboard
                </Link>
            </div>
        </div>
    );
}
