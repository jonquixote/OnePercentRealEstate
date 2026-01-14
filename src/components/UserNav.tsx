'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { User } from '@supabase/supabase-js';
import { LogOut, Settings, User as UserIcon, LogIn } from 'lucide-react';

export default function UserNav() {
    const [user, setUser] = useState<User | null>(null);
    const [isOpen, setIsOpen] = useState(false);
    const router = useRouter();

    useEffect(() => {
        // Get initial session
        supabase.auth.getUser().then(({ data: { user } }) => {
            setUser(user);
        });

        // Listen for changes
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user ?? null);
        });

        return () => subscription.unsubscribe();
    }, []);

    const handleSignOut = async () => {
        await supabase.auth.signOut();
        router.push('/');
        router.refresh();
    };

    if (!user) {
        return (
            <Link
                href="/login"
                className="text-sm font-semibold leading-6 text-white hover:text-emerald-400 transition-colors flex items-center"
            >
                Log in <span aria-hidden="true" className="ml-1">&rarr;</span>
            </Link>
        );
    }

    return (
        <div className="relative ml-6">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 rounded-full ring-2 ring-emerald-500/20 bg-slate-800 p-1 pr-3 hover:bg-slate-700 transition-colors"
            >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-sm font-bold text-white">
                    {user.email?.charAt(0).toUpperCase() || 'U'}
                </div>
                <span className="text-sm font-medium text-white hidden sm:block">
                    Account
                </span>
            </button>

            {/* Dropdown Menu */}
            {isOpen && (
                <>
                    <div
                        className="fixed inset-0 z-30"
                        onClick={() => setIsOpen(false)}
                    />
                    <div className="absolute right-0 mt-2 w-48 origin-top-right rounded-md bg-white py-1 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none z-40">
                        <div className="px-4 py-3 border-b border-gray-100">
                            <p className="text-xs text-gray-500 truncate">Signed in as</p>
                            <p className="text-sm font-medium text-gray-900 truncate">
                                {user.email}
                            </p>
                        </div>

                        <Link
                            href="/settings"
                            onClick={() => setIsOpen(false)}
                            className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                            <Settings className="mr-3 h-4 w-4 text-gray-400" />
                            Settings
                        </Link>

                        <button
                            onClick={handleSignOut}
                            className="flex w-full items-center px-4 py-2 text-left text-sm text-red-700 hover:bg-red-50"
                        >
                            <LogOut className="mr-3 h-4 w-4 text-red-500" />
                            Sign out
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
