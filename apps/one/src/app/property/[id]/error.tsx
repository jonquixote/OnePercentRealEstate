'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function PropertyError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    useEffect(() => {
        console.error(error);
    }, [error]);

    return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 bg-gray-50 p-4">
            <h2 className="text-2xl font-semibold text-gray-900">Could not load this property</h2>
            <p className="text-gray-500 text-sm text-center max-w-md">
                {error.message || 'An unexpected error occurred while loading the property page.'}
            </p>
            <div className="flex gap-3 mt-2">
                <button
                    onClick={() => reset()}
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
                >
                    Try again
                </button>
                <Link
                    href="/"
                    className="rounded-md bg-white border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                    Back to dashboard
                </Link>
            </div>
        </div>
    );
}
