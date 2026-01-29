'use client';

import Link from 'next/link';
import { LogIn } from 'lucide-react';

// Simplified UserNav without Supabase auth
// To re-enable authentication, implement with NextAuth.js or similar
export default function UserNav() {
    return (
        <Link
            href="/login"
            className="text-sm font-semibold leading-6 text-white hover:text-emerald-400 transition-colors flex items-center"
        >
            Log in <span aria-hidden="true" className="ml-1">&rarr;</span>
        </Link>
    );
}
