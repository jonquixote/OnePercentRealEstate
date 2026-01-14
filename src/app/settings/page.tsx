'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { User } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import { UserCircle, CreditCard, Mail } from 'lucide-react';

export default function SettingsPage() {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const router = useRouter();

    useEffect(() => {
        const getUser = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                router.push('/login');
                return;
            }
            setUser(user);
            setLoading(false);
        };
        getUser();
    }, [router]);

    if (loading) {
        return <div className="min-h-screen bg-gray-50 flex items-center justify-center">Loading...</div>;
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <Header />
            <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-10">
                <h1 className="text-3xl font-bold text-gray-900 mb-8">Account Settings</h1>

                {/* Profile Section */}
                <div className="bg-white shadow sm:rounded-lg mb-6 overflow-hidden">
                    <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
                        <h3 className="text-lg font-medium leading-6 text-gray-900 flex items-center">
                            <UserCircle className="mr-2 h-5 w-5 text-gray-400" />
                            Profile
                        </h3>
                        <p className="mt-1 max-w-2xl text-sm text-gray-500">Your personal information.</p>
                    </div>
                    <div className="px-4 py-5 sm:p-6">
                        <div className="grid grid-cols-6 gap-6">
                            <div className="col-span-6 sm:col-span-4">
                                <label className="block text-sm font-medium text-gray-700">Email Address</label>
                                <div className="mt-1 flex rounded-md shadow-sm">
                                    <span className="inline-flex items-center rounded-l-md border border-r-0 border-gray-300 bg-gray-50 px-3 text-gray-500 sm:text-sm">
                                        <Mail className="h-4 w-4" />
                                    </span>
                                    <input
                                        type="text"
                                        disabled
                                        value={user?.email}
                                        className="block w-full flex-1 rounded-none rounded-r-md border-gray-300 focus:border-emerald-500 focus:ring-emerald-500 sm:text-sm bg-gray-100 text-gray-500 px-3 py-2 cursor-not-allowed"
                                    />
                                </div>
                                <p className="mt-2 text-xs text-gray-500">Email cannot be changed directly here.</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Subscription Section */}
                <div className="bg-white shadow sm:rounded-lg overflow-hidden">
                    <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
                        <h3 className="text-lg font-medium leading-6 text-gray-900 flex items-center">
                            <CreditCard className="mr-2 h-5 w-5 text-gray-400" />
                            Subscription
                        </h3>
                        <p className="mt-1 max-w-2xl text-sm text-gray-500">Manage your plan and billing.</p>
                    </div>
                    <div className="px-4 py-5 sm:p-6">
                        <div className="bg-emerald-50 border border-emerald-200 rounded-md p-4 mb-4">
                            <div className="flex">
                                <div className="flex-shrink-0">
                                    <CreditCard className="h-5 w-5 text-emerald-400" aria-hidden="true" />
                                </div>
                                <div className="ml-3">
                                    <h3 className="text-sm font-medium text-emerald-800">Current Plan</h3>
                                    <div className="mt-2 text-sm text-emerald-700">
                                        <p>You are currently on the <span className="font-bold">Free Plan</span>.</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="mt-4">
                            <button
                                type="button"
                                onClick={() => router.push('/pricing')}
                                className="inline-flex items-center rounded-md border border-transparent bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
                            >
                                Upgrade to Pro
                            </button>
                            <button
                                type="button"
                                className="ml-3 inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
                            >
                                Manage Billing (Stripe)
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
