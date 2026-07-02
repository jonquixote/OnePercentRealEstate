'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    useEffect(() => {
        console.error(error);
    }, [error]);

    return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 bg-ink p-4">
            <h2 className="text-2xl font-semibold text-foreground">Something went wrong</h2>
            <p className="text-muted-foreground text-sm text-center max-w-md">
                {error.message || 'An unexpected error occurred. Please try again.'}
            </p>
            <div className="flex gap-3 mt-2">
                <button
                    onClick={() => reset()}
                    className="rounded-md bg-pass px-4 py-2 text-sm font-medium text-white hover:bg-pass-hi transition-colors"
                >
                    Try again
                </button>
                <Link
                    href="/"
                    className="rounded-md bg-ink-panel border border-line px-4 py-2 text-sm font-medium text-foreground hover:bg-ink-2 transition-colors"
                >
                    Go home
                </Link>
            </div>
        </div>
    );
}
