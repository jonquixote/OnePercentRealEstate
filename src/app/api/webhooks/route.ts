import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import pool from '@/lib/db';
import redis from '@/lib/redis';
import { safeErrorResponse } from '@/lib/api-error';

const WEBHOOK_IDEMPOTENCY_TTL = 60 * 60 * 24;

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  const metadataUserId = session.metadata?.userId;
  const customerId = session.customer as string;
  const customerEmail = session.customer_details?.email || session.customer_email;

  if (!customerId) return;

  const client = await pool.connect();
  try {
    let resolvedUserId: string | null = null;

    if (metadataUserId) {
      const ownerCheck = await client.query(
        `SELECT id FROM profiles WHERE id = $1 AND stripe_customer_id IS NOT NULL AND stripe_customer_id <> $2 LIMIT 1`,
        [metadataUserId, customerId]
      );
      if (ownerCheck.rowCount && ownerCheck.rowCount > 0) {
        const conflict = await client.query(
          `SELECT id FROM profiles WHERE id <> $1 AND stripe_customer_id = $2 LIMIT 1`,
          [metadataUserId, customerId]
        );
        if (!conflict.rowCount) {
          resolvedUserId = metadataUserId;
        }
      }
    }

    if (!resolvedUserId && customerEmail) {
      const byEmail = await client.query(
        `SELECT id FROM profiles WHERE email = $1 LIMIT 1`,
        [customerEmail]
      );
      if (byEmail.rowCount && byEmail.rowCount > 0) {
        resolvedUserId = byEmail.rows[0].id;
      }
    }

    if (!resolvedUserId) {
      const inserted = await client.query(
        `INSERT INTO profiles (id, stripe_customer_id, subscription_tier, email, updated_at)
         VALUES (gen_random_uuid()::text, $1, 'pro', $2, NOW())
         ON CONFLICT (stripe_customer_id) DO UPDATE SET
           subscription_tier = 'pro',
           email = COALESCE(EXCLUDED.email, profiles.email),
           updated_at = NOW()
         RETURNING id`,
        [customerId, customerEmail ?? null]
      );
      resolvedUserId = inserted.rows[0]?.id ?? null;
    } else {
      await client.query(
        `INSERT INTO profiles (id, stripe_customer_id, subscription_tier, email, updated_at)
         VALUES ($1, $2, 'pro', $3, NOW())
         ON CONFLICT (id) DO UPDATE SET
           stripe_customer_id = $2,
           subscription_tier = 'pro',
           email = COALESCE(EXCLUDED.email, profiles.email),
           updated_at = NOW()`,
        [resolvedUserId, customerId, customerEmail ?? null]
      );
    }
  } finally {
    client.release();
  }
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;
  const status = subscription.status;

  let subscription_tier: 'free' | 'pro' = 'free';

  switch (status) {
    case 'active':
    case 'trialing':
      subscription_tier = 'pro';
      break;
    case 'canceled':
    case 'unpaid':
    case 'incomplete':
    case 'past_due':
    case 'paused':
      subscription_tier = 'free';
      break;
    default:
      console.warn(`Unhandled subscription status: ${status}`);
      return;
  }

  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE profiles
       SET subscription_tier = $1, updated_at = NOW()
       WHERE stripe_customer_id = $2`,
      [subscription_tier, customerId]
    );
  } finally {
    client.release();
  }
}

export async function POST(req: Request) {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    console.error('Stripe keys are missing');
    return NextResponse.json({ error: 'Internal Server Configuration Error' }, { status: 500 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2026-02-25.clover',
  });
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  const body = await req.text();
  const sig = req.headers.get('stripe-signature')!;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err: any) {
    console.error(`Webhook Error: ${err.message}`);
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
  }

  const idempotencyKey = `webhook:${event.id}`;
  try {
    const set = await redis.set(idempotencyKey, '1', 'EX', WEBHOOK_IDEMPOTENCY_TTL, 'NX');
    if (set === null) {
      return NextResponse.json({ received: true, duplicate: true });
    }
  } catch (err) {
    console.warn('Redis idempotency check failed, processing event anyway:', err);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutSessionCompleted(session);
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdated(subscription);
        break;
      }
      default:
    }
  } catch (error) {
    console.error('Error handling webhook event:', error);
    return safeErrorResponse(error, 500);
  }

  return NextResponse.json({ received: true });
}
