'use client';

import { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Check, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import stripePromise from '@/lib/stripe';
import { cn } from '@/lib/utils';
import Link from 'next/link';

const tiers = [
    {
        name: 'Free',
        id: 'free',
        href: '/login',
        price: '$0',
        description: 'Perfect for exploring the market and learning the ropes.',
        features: [
            '3 Saved Properties',
            'Basic 1% Rule Analysis',
            'Market Overview',
            'Community Support',
        ],
        cta: 'Get Started',
        featured: false,
    },
    {
        name: 'Pro Investor',
        id: 'pro',
        href: '#',
        price: '$19',
        period: '/month',
        description: 'For serious investors building a rental portfolio.',
        features: [
            'Unlimited Property Saves',
            'Advanced Metrics (Cap Rate, CoC)',
            'PDF Reports & Exports',
            'Watchlist Alerts',
            'Priority Support',
        ],
        cta: 'Upgrade to Pro',
        featured: true,
    },
    {
        name: 'Agency Team',
        id: 'agency',
        href: '#',
        price: '$49',
        period: '/month',
        description: 'For brokerages and teams scaling operations.',
        features: [
            'Everything in Pro',
            '5 Team Members',
            'White-label PDF Reports',
            'CRM Integration (Coming Soon)',
            'Dedicated Account Manager',
        ],
        cta: 'Contact Sales',
        featured: false,
    },
];

export default function PricingPage() {
    const [loading, setLoading] = useState<string | null>(null);
    const router = useRouter();

    const handleCheckout = async (tierId: string) => {
        if (tierId === 'free') {
            router.push('/login');
            return;
        }

        setLoading(tierId);

        try {
            const response = await fetch('/api/checkout', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    priceId: tierId === 'pro' ? process.env.NEXT_PUBLIC_STRIPE_PRICE_ID_PRO : 'contact_sales',
                    propertyId: 'subscription_upgrade',
                    userId: 'current_user_id_placeholder', // Should be fetched from auth context
                }),
            });

            const { sessionId, error } = await response.json();

            if (error) {
                throw new Error(error);
            }

            const stripe = await stripePromise;
            if (stripe) {
                // @ts-ignore
                await stripe.redirectToCheckout({ sessionId });
            }
        } catch (err: any) {
            console.error('Checkout error:', err);
            alert('Checkout failed. Please ensure you are logged in and config is set.');
        } finally {
            setLoading(null);
        }
    };

    return (
        <div className="bg-slate-900 min-h-screen py-24 sm:py-32">
            <div className="mx-auto max-w-7xl px-6 lg:px-8">
                <div className="mx-auto max-w-4xl text-center">
                    <h2 className="text-base font-semibold leading-7 text-emerald-400">Pricing</h2>
                    <p className="mt-2 text-4xl font-bold tracking-tight text-white sm:text-5xl">
                        Clarity Over Complexity
                    </p>
                    <p className="mt-6 text-lg leading-8 text-gray-300">
                        Stop using spreadsheets. Start analyzing deals in seconds. <br />
                        Choose the plan that fits your investment journey.
                    </p>
                </div>
                <div className="isolate mx-auto mt-16 grid max-w-md grid-cols-1 gap-y-8 sm:mt-20 lg:mx-0 lg:max-w-none lg:grid-cols-3">
                    {tiers.map((tier) => (
                        <div
                            key={tier.id}
                            className={cn(
                                tier.featured ? 'bg-white/5 ring-2 ring-emerald-500' : 'list-inside bg-white/5 ring-1 ring-white/10',
                                'rounded-3xl p-8 xl:p-10 transition-all hover:scale-105 duration-300'
                            )}
                        >
                            <div className="flex items-center justify-between gap-x-4">
                                <h3
                                    id={tier.id}
                                    className={cn(
                                        tier.featured ? 'text-emerald-400' : 'text-white',
                                        'text-lg font-semibold leading-8'
                                    )}
                                >
                                    {tier.name}
                                </h3>
                                {tier.featured && (
                                    <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold leading-5 text-emerald-400">
                                        Most Popular
                                    </span>
                                )}
                            </div>
                            <p className="mt-4 text-sm leading-6 text-gray-300">{tier.description}</p>
                            <p className="mt-6 flex items-baseline gap-x-1">
                                <span className="text-4xl font-bold tracking-tight text-white">{tier.price}</span>
                                {tier.period && <span className="text-sm font-semibold leading-6 text-gray-300">{tier.period}</span>}
                            </p>
                            <button
                                onClick={() => handleCheckout(tier.id)}
                                disabled={loading !== null}
                                className={cn(
                                    tier.featured
                                        ? 'bg-emerald-500 text-white shadow-sm hover:bg-emerald-400 focus-visible:outline-emerald-500'
                                        : 'bg-white/10 text-white hover:bg-white/20 focus-visible:outline-white',
                                    'mt-6 block w-full rounded-md px-3 py-2 text-center text-sm font-semibold leading-6 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed'
                                )}
                            >
                                {loading === tier.id ? (
                                    <Loader2 className="animate-spin h-5 w-5 mx-auto" />
                                ) : (
                                    tier.cta
                                )}
                            </button>
                            <ul role="list" className="mt-8 space-y-3 text-sm leading-6 text-gray-300">
                                {tier.features.map((feature) => (
                                    <li key={feature} className="flex gap-x-3">
                                        <Check className="h-6 w-5 flex-none text-white" aria-hidden="true" />
                                        {feature}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>

                <div className="mt-16 text-center">
                    <Link href="/" className="text-sm font-semibold leading-6 text-gray-400 hover:text-white transition-colors">
                        Back to Dashboard <span aria-hidden="true">→</span>
                    </Link>
                </div>
            </div>
        </div>
    );
}
