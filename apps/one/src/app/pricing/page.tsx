'use client';

import { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Check, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import stripePromise from '@/lib/stripe';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useToast } from '@/components/ui/toast';

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
        href: 'mailto:sales@onepercent.com?subject=Agency%20Team%20Inquiry',
        price: 'Custom',
        description: 'For brokerages and teams scaling operations.',
        features: [
            'Everything in Pro',
            '5 Team Members',
            'White-label PDF Reports',
            'CRM Integration (Coming Soon)',
            'Dedicated Account Manager',
        ],
        cta: 'Contact us',
        featured: false,
    },
];

export default function PricingPage() {
    const [loading, setLoading] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const router = useRouter();

  const handleCheckout = async (tierId: string) => {
    if (tierId === 'free') {
      router.push('/login');
      return;
    }
    if (tierId === 'agency') {
      window.location.href = 'mailto:sales@onepercent.com?subject=Agency%20Team%20Inquiry';
      return;
    }

    setLoading(tierId);
    setError(null);

    try {
      const body: Record<string, string> = {
        plan: 'monthly',
        propertyId: 'subscription_upgrade',
      };

      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401 || data.error === 'Unauthorized') {
          router.push('/login?returnUrl=/pricing');
          return;
        }
        throw new Error(data.error || 'Checkout failed');
      }

      const { sessionId } = data;

      const stripe = await stripePromise;
      if (stripe) {
        // @ts-ignore
        await stripe.redirectToCheckout({ sessionId });
      }
    } catch (err: any) {
      console.error('Checkout error:', err);
      setError('Checkout failed. Please ensure you are logged in and config is set.');
    } finally {
      setLoading(null);
    }
  };

    return (
        <div style={{ background: 'var(--ink)', color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>
            <div className="min-h-screen py-24 sm:py-32">
                {error && (
                    <div role="alert" className="mx-auto max-w-3xl mb-6 rounded-md px-4 py-3 text-sm" style={{ border: '1px solid color-mix(in srgb, var(--loss) 40%, transparent)', background: 'color-mix(in srgb, var(--loss) 10%, transparent)', color: 'var(--loss)' }}>
                        {error}
                    </div>
                )}
                <div className="mx-auto max-w-7xl px-6 lg:px-8">
                    <div className="mx-auto max-w-4xl text-center">
                        <p className="prov prov--est mb-4 inline-block">Pricing</p>
                        <h1 style={{ font: '400 var(--display-1)/1.05 var(--font-display)' }}>
                            Clarity Over Complexity
                        </h1>
                        <p className="mt-6 text-[16px] leading-8" style={{ color: 'var(--haze)' }}>
                            Stop using spreadsheets. Start analyzing deals in seconds. <br />
                            Choose the plan that fits your investment journey.
                        </p>
                    </div>
                    <div className="isolate mx-auto mt-16 grid max-w-md grid-cols-1 gap-y-8 sm:mt-20 lg:mx-0 lg:max-w-none lg:grid-cols-3">
                        {tiers.map((tier) => (
                            <div
                                key={tier.id}
                                className={cn(
                                    tier.featured ? 'ring-2' : 'ring-1',
                                    'rounded-[var(--r-panel)] p-8 xl:p-10 transition-all hover:scale-105 duration-300'
                                )}
                                style={{
                                    background: tier.featured ? 'var(--ink-panel)' : 'var(--ink-2)',
                                    borderColor: tier.featured ? 'var(--pass)' : 'var(--line)',
                                    borderWidth: '1px',
                                }}
                            >
                                <div className="flex items-center justify-between gap-x-4">
                                    <h3
                                        id={tier.id}
                                        className="text-[18px] font-semibold"
                                        style={{ color: tier.featured ? 'var(--pass-hi)' : 'var(--text)' }}
                                    >
                                        {tier.name}
                                    </h3>
                                    {tier.featured && (
                                        <span className="prov prov--real">
                                            Most Popular
                                        </span>
                                    )}
                                </div>
                                <p className="mt-4 text-[14px] leading-6" style={{ color: 'var(--haze)' }}>{tier.description}</p>
                                <p className="mt-6 flex items-baseline gap-x-1">
                                    <span className="text-[36px] font-bold" style={{ color: 'var(--text)' }}>{tier.price}</span>
                                    {'period' in tier && tier.period && <span className="text-[13px] font-semibold" style={{ color: 'var(--haze)' }}>{tier.period}</span>}
                                </p>
                                <button
                                    onClick={() => handleCheckout(tier.id)}
                                    disabled={loading !== null}
                                    className={cn(
                                        'mt-6 block w-full rounded-[var(--r-chip)] px-3 py-2 text-center text-[13px] font-semibold leading-6 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
                                    )}
                                    style={{
                                        background: tier.featured ? 'var(--pass)' : 'var(--ink-panel)',
                                        color: tier.featured ? '#fff' : 'var(--text)',
                                        border: tier.featured ? 'none' : '1px solid var(--line)',
                                    }}
                                >
                                    {loading === tier.id ? (
                                        <Loader2 className="animate-spin h-5 w-5 mx-auto" />
                                    ) : (
                                        tier.cta
                                    )}
                                </button>
                                <ul role="list" className="mt-8 space-y-3 text-[14px] leading-6" style={{ color: 'var(--haze)' }}>
                                    {tier.features.map((feature) => (
                                        <li key={feature} className="flex gap-x-3">
                                            <Check className="h-6 w-5 flex-none" style={{ color: 'var(--pass-hi)' }} aria-hidden="true" />
                                            {feature}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>

                    <div className="mt-16 text-center">
                        <Link href="/" className="text-[13px] font-semibold transition-colors" style={{ color: 'var(--mute)' }}>
                            Back to Dashboard <span aria-hidden="true">→</span>
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
