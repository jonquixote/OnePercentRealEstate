'use client';

import { Suspense, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Check, Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import stripePromise from '@/lib/stripe';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import {
  entitlementsFor,
  COMPARE_FREE_MAX,
  COMPARE_PRO_MAX,
  LAYOUT_FREE_MAX,
  LAYOUT_PRO_MAX,
  type Gate,
} from '@/lib/entitlements';

// Fail-open: if the publishable key for the client Stripe bundle is absent,
// we never call /api/checkout — instead the Pro CTA becomes a mailto.
const HAS_STRIPE = Boolean(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
// Agency column only ships when its Stripe price id exists (risk audit
// 2026-07-07: otherwise the checkout route returns a clean 400 for agency).
// Must be NEXT_PUBLIC_ — this is a client component and the value is inlined
// at build time, so a server-only var would always be undefined here.
const HAS_AGENCY = Boolean(process.env.NEXT_PUBLIC_STRIPE_PRICE_AGENCY);

const PRO_MAILTO = 'mailto:sales@onepercent.com?subject=Upgrade%20to%20Pro';
const AGENCY_MAILTO = 'mailto:sales@onepercent.com?subject=Agency%20Team%20Inquiry';

const GATE_ROWS: Record<Gate, string> = {
  compare: 'Compare side-by-side',
  alerts: 'Alerts',
  layouts: 'Saved layouts (Pro Terminal)',
};

interface Row {
  label: string;
  free: string;
  pro: string;
  gate?: Gate;
}

const free = entitlementsFor('free');
const pro = entitlementsFor('pro');

const ROWS: Row[] = [
  { label: 'Compare side-by-side', free: String(COMPARE_FREE_MAX), pro: String(COMPARE_PRO_MAX), gate: 'compare' },
  { label: 'Saved layouts (Pro Terminal)', free: String(LAYOUT_FREE_MAX), pro: String(LAYOUT_PRO_MAX), gate: 'layouts' },
  { label: 'Alerts', free: 'Daily digest', pro: 'Instant', gate: 'alerts' },
];

// Pro marketing truths — keep as Pro-only bullets (no dark patterns; the
// free alternative for each is named in the compare/alerts/layouts rows above).
const PRO_FEATURES = [
  'Unlimited Property Saves',
  'Advanced Metrics (Cap Rate, CoC)',
  'PDF Reports & Exports',
  'Watchlist Alerts',
  'Priority Support',
  'Pro Terminal — saved screens, 20 investor columns, market charts, CSV export, email alerts',
];

function PricingBody() {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = (searchParams.get('from') as Gate | null) ?? undefined;
  const highlightGate = from && Object.prototype.hasOwnProperty.call(GATE_ROWS, from) ? from : undefined;

  const handleCheckout = async (tierId: string) => {
    if (tierId === 'free') {
      router.push('/login');
      return;
    }
    if (tierId === 'agency') {
      window.location.href = AGENCY_MAILTO;
      return;
    }

    // Fail-open: no Stripe bundle key → bounce to mailto, no /api/checkout call.
    if (!HAS_STRIPE) {
      window.location.href = PRO_MAILTO;
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
          router.push('/login?returnUrl=/terminal');
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

  // Pro column always carries the brass ring width/color for visual
  // consistency; the highlight branch deepens it.
  const proColRing = highlightGate ? 'ring-2 ring-brass' : 'ring-1 ring-brass';
  const proColBorder = highlightGate ? 'var(--brass-hi)' : 'var(--pass)';

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

          <div className={cn(
            'isolate mx-auto mt-16 grid max-w-md grid-cols-1 gap-y-8 sm:mt-20 lg:mx-0 lg:max-w-none',
            HAS_AGENCY ? 'lg:grid-cols-3' : 'lg:grid-cols-2'
          )}>
            {/* Free column */}
            <div
              className="rounded-[var(--r-panel)] p-8 xl:p-10 transition-all hover:scale-105 duration-300 ring-1"
              style={{
                background: 'var(--ink-2)',
                borderColor: 'var(--line)',
                borderWidth: '1px',
              }}
            >
              <div className="flex items-center justify-between gap-x-4">
                <h3 id="free" className="text-[18px] font-semibold" style={{ color: 'var(--text)' }}>
                  Free
                </h3>
              </div>
              <p className="mt-4 text-[14px] leading-6" style={{ color: 'var(--haze)' }}>
                Perfect for exploring the market and learning the ropes.
              </p>
              <p className="mt-6 flex items-baseline gap-x-1">
                <span className="text-[36px] font-bold" style={{ color: 'var(--text)' }}>$0</span>
              </p>
              <button
                onClick={() => handleCheckout('free')}
                disabled={loading !== null}
                className="mt-6 block w-full rounded-[var(--r-chip)] px-3 py-2 text-center text-[13px] font-semibold leading-6 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                style={{
                  background: 'var(--ink-panel)',
                  color: 'var(--text)',
                  border: '1px solid var(--line)',
                }}
              >
                {loading === 'free' ? <Loader2 className="animate-spin h-5 w-5 mx-auto" /> : 'Get Started'}
              </button>
              <table className="mt-8 w-full text-[14px]" style={{ color: 'var(--haze)' }}>
                <tbody>
                  {ROWS.map((row) => (
                    <tr key={row.label} className="border-t" style={{ borderColor: 'var(--line)' }}>
                      <td className="py-3 pr-3">{row.label}</td>
                      <td className="py-3 text-right font-semibold" style={{ color: 'var(--text)' }}>{row.free}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul role="list" className="mt-6 space-y-3 text-[14px] leading-6" style={{ color: 'var(--haze)' }}>
                <li className="flex gap-x-3"><Check className="h-6 w-5 flex-none" style={{ color: 'var(--pass-hi)' }} aria-hidden="true" />3 Saved Properties</li>
                <li className="flex gap-x-3"><Check className="h-6 w-5 flex-none" style={{ color: 'var(--pass-hi)' }} aria-hidden="true" />Basic 1% Rule Analysis</li>
                <li className="flex gap-x-3"><Check className="h-6 w-5 flex-none" style={{ color: 'var(--pass-hi)' }} aria-hidden="true" />Market Overview</li>
                <li className="flex gap-x-3"><Check className="h-6 w-5 flex-none" style={{ color: 'var(--pass-hi)' }} aria-hidden="true" />Community Support</li>
              </ul>
            </div>

            {/* Pro column */}
            <div
              data-from={highlightGate ?? ''}
              className={cn(proColRing, 'rounded-[var(--r-panel)] p-8 xl:p-10 transition-all hover:scale-105 duration-300')}
              style={{
                background: 'var(--ink-panel)',
                borderColor: proColBorder,
                borderWidth: '1px',
              }}
            >
              <div className="flex items-center justify-between gap-x-4">
                <h3 id="pro" className="text-[18px] font-semibold" style={{ color: 'var(--pass-hi)' }}>
                  Pro Investor
                </h3>
                <span className="prov prov--real">Most Popular</span>
              </div>
              {highlightGate && (
                <span className="prov prov--brass mt-3 inline-block">Recommended for you</span>
              )}
              <p className="mt-4 text-[14px] leading-6" style={{ color: 'var(--haze)' }}>
                For serious investors building a rental portfolio.
              </p>
              <p className="mt-6 flex items-baseline gap-x-1">
                <span className="text-[36px] font-bold" style={{ color: 'var(--text)' }}>$19</span>
                <span className="text-[13px] font-semibold" style={{ color: 'var(--haze)' }}>/month</span>
              </p>
              {HAS_STRIPE ? (
                <button
                  onClick={() => handleCheckout('pro')}
                  disabled={loading !== null}
                  className="mt-6 block w-full rounded-[var(--r-chip)] px-3 py-2 text-center text-[13px] font-semibold leading-6 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  style={{ background: 'var(--pass)', color: '#fff', border: 'none' }}
                >
                  {loading === 'pro' ? <Loader2 className="animate-spin h-5 w-5 mx-auto" /> : 'Upgrade to Pro'}
                </button>
              ) : (
                <a
                  href={PRO_MAILTO}
                  className="mt-6 block w-full rounded-[var(--r-chip)] px-3 py-2 text-center text-[13px] font-semibold leading-6 transition-colors"
                  style={{ background: 'var(--pass)', color: '#fff', border: 'none' }}
                >
                  Checkout coming online — email us
                </a>
              )}
              <table className="mt-8 w-full text-[14px]" style={{ color: 'var(--haze)' }}>
                <tbody>
                  {ROWS.map((row) => (
                    <tr
                      key={row.label}
                      data-from={row.gate === highlightGate ? row.gate : ''}
                      className="border-t"
                      style={{ borderColor: 'var(--line)' }}
                    >
                      <td className="py-3 pr-3">
                        {row.label}
                        {row.gate === highlightGate && (
                          <span className="prov prov--brass ml-2 align-middle">Recommended for you</span>
                        )}
                      </td>
                      <td className="py-3 text-right font-semibold" style={{ color: 'var(--text)' }}>{row.pro}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul role="list" className="mt-6 space-y-3 text-[14px] leading-6" style={{ color: 'var(--haze)' }}>
                {PRO_FEATURES.map((feature) => (
                  <li key={feature} className="flex gap-x-3">
                    <Check className="h-6 w-5 flex-none" style={{ color: 'var(--pass-hi)' }} aria-hidden="true" />
                    {feature}
                  </li>
                ))}
              </ul>
            </div>

            {/* Agency column — conditional */}
            {HAS_AGENCY && (
              <div
                className="rounded-[var(--r-panel)] p-8 xl:p-10 transition-all hover:scale-105 duration-300 ring-1"
                style={{
                  background: 'var(--ink-2)',
                  borderColor: 'var(--line)',
                  borderWidth: '1px',
                }}
              >
                <div className="flex items-center justify-between gap-x-4">
                  <h3 id="agency" className="text-[18px] font-semibold" style={{ color: 'var(--text)' }}>
                    Agency Team
                  </h3>
                </div>
                <p className="mt-4 text-[14px] leading-6" style={{ color: 'var(--haze)' }}>
                  For brokerages and teams scaling operations.
                </p>
                <p className="mt-6 flex items-baseline gap-x-1">
                  <span className="text-[36px] font-bold" style={{ color: 'var(--text)' }}>Custom</span>
                </p>
                <a
                  href={AGENCY_MAILTO}
                  className="mt-6 block w-full rounded-[var(--r-chip)] px-3 py-2 text-center text-[13px] font-semibold leading-6 transition-colors"
                  style={{ background: 'var(--ink-panel)', color: 'var(--text)', border: '1px solid var(--line)' }}
                >
                  Contact us
                </a>
                <ul role="list" className="mt-8 space-y-3 text-[14px] leading-6" style={{ color: 'var(--haze)' }}>
                  <li className="flex gap-x-3"><Check className="h-6 w-5 flex-none" style={{ color: 'var(--pass-hi)' }} aria-hidden="true" />Everything in Pro</li>
                  <li className="flex gap-x-3"><Check className="h-6 w-5 flex-none" style={{ color: 'var(--pass-hi)' }} aria-hidden="true" />5 Team Members</li>
                  <li className="flex gap-x-3"><Check className="h-6 w-5 flex-none" style={{ color: 'var(--pass-hi)' }} aria-hidden="true" />White-label PDF Reports</li>
                  <li className="flex gap-x-3"><Check className="h-6 w-5 flex-none" style={{ color: 'var(--pass-hi)' }} aria-hidden="true" />CRM Integration (Coming Soon)</li>
                  <li className="flex gap-x-3"><Check className="h-6 w-5 flex-none" style={{ color: 'var(--pass-hi)' }} aria-hidden="true" />Dedicated Account Manager</li>
                </ul>
              </div>
            )}
          </div>

          <div
            className="mt-16 grid items-center gap-8 rounded-[var(--r-panel)] p-8 lg:grid-cols-2"
            style={{ background: 'var(--ink-2)', border: '1px solid var(--line)' }}
          >
            <div>
              <p className="prov prov--real mb-3 inline-block">Included in Pro</p>
              <h2 className="text-[22px] font-semibold" style={{ color: 'var(--text)' }}>
                Pro Terminal
              </h2>
              <p className="mt-3 text-[15px] leading-7" style={{ color: 'var(--haze)' }}>
                A keyboard-driven data terminal for serious investors: saved
                screens, 20+ investor columns, market charts, CSV export, and
                daily email alerts on your filters. Free accounts get a read-only
                50-row demo.
              </p>
              <Link
                href="/terminal"
                className="mt-5 inline-block rounded-[var(--r-chip)] px-4 py-2 text-[13px] font-semibold text-white transition-colors"
                style={{ background: 'var(--pass)' }}
              >
                Open the Terminal →
              </Link>
            </div>
            <div
              className="hidden min-h-[180px] items-center justify-center rounded-[var(--r-panel)] font-mono text-[12px] lg:flex"
              style={{ background: 'var(--ink-panel)', border: '1px solid var(--line)', color: 'var(--mute)' }}
            >
              $19/mo · full access · free = 50-row demo
            </div>
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

// Wrap in Suspense so useSearchParams() does not de-opt the page to CSR
// during static generation (Next.js App Router requirement).
export default function PricingPage() {
  return (
    <Suspense fallback={null}>
      <PricingBody />
    </Suspense>
  );
}
