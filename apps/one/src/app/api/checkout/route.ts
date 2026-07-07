import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { z } from 'zod';
import { safeErrorResponse } from '@/lib/api-error';
import { checkRateLimit, checkoutLimiter } from '@/lib/rate-limit';
import { getSessionUser } from '@/lib/auth';

const VALID_PRICE_IDS: Record<string, string | undefined> = {
  monthly: process.env.STRIPE_PRICE_MONTHLY,
  annual: process.env.STRIPE_PRICE_ANNUAL,
  // Agency tier ships when the owner creates its Stripe price; until then
  // requests for it get the clean 400 below rather than silently charging
  // the wrong amount (security review 2026-07-07: pricing bypass).
  agency: process.env.STRIPE_PRICE_AGENCY,
};

const checkoutSchema = z.object({
  plan: z.enum(['monthly', 'annual', 'agency']).optional(),
  priceId: z.string().startsWith('price_').max(200).optional(),
  propertyId: z.string().max(200).optional(),
  userId: z.string().max(200).optional(),
  email: z.string().email().max(320).optional(),
}).refine(
  (data) => Boolean(data.plan) !== Boolean(data.priceId),
  { message: 'Provide either plan or priceId, not both' }
);

export async function POST(req: Request) {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY is missing');
    return NextResponse.json({ error: 'Internal Server Configuration Error' }, { status: 500 });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  const limit = await checkRateLimit(checkoutLimiter, ip);
  if (!limit.allowed) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
      status: 429,
      headers: { 'Retry-After': String(limit.retryAfter || 60) },
    });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2026-02-25.clover',
  });

  try {
    const raw = await req.json();
    const body = checkoutSchema.parse(raw);

    // Wave 5: subscription identity comes from the SESSION, never the client
    // body — the webhook grants the tier to metadata.userId, so a spoofable
    // userId would let anyone gift themselves (or others) entitlements.
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const resolvedPriceId = body.plan
      ? VALID_PRICE_IDS[body.plan]
      : body.priceId;

    if (!resolvedPriceId) {
      return NextResponse.json(
        { error: 'Invalid or missing price configuration' },
        { status: 400 }
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: sessionUser.email || undefined,
      line_items: [
        {
          price: resolvedPriceId,
          quantity: 1,
        },
      ],
      // Origin header is absent on non-browser clients; fall back to the
      // canonical site URL rather than sending Stripe an invalid "null/..."
      success_url: `${req.headers.get('origin') ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'https://one.octavo.press'}/?upgrade_success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.get('origin') ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'https://one.octavo.press'}/pricing?canceled=true`,
      metadata: {
        propertyId: body.propertyId || '',
        userId: sessionUser.id,
      },
    });

    return NextResponse.json({ sessionId: session.id });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request', details: err.flatten() },
        { status: 400 }
      );
    }
    console.error('Stripe Checkout Error:', err);
    return safeErrorResponse(err, 500);
  }
}
