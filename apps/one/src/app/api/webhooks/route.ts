import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import pool from '@/lib/db';

const MAX_ATTEMPTS = 5;

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

async function dispatchEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      await handleCheckoutSessionCompleted(session);
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      await handleSubscriptionUpdated(subscription);
      break;
    }
    default:
    // No-op for unhandled event types — we still record them as processed
    // in stripe_webhook_events so Stripe doesn't keep retrying.
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
  const sig = req.headers.get('stripe-signature');

  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err: any) {
    console.error(`Webhook Error: ${err.message}`);
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
  }

  // --- DB-backed idempotency: record-or-find this event row.
  // INSERT ... ON CONFLICT DO NOTHING then SELECT gives us the current
  // state regardless of whether we won or lost the race.
  let alreadyProcessed = false;
  try {
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO stripe_webhook_events (id, type)
         VALUES ($1, $2)
         ON CONFLICT (id) DO NOTHING`,
        [event.id, event.type]
      );
      const existing = await client.query(
        `SELECT processed_at, attempts FROM stripe_webhook_events WHERE id = $1`,
        [event.id]
      );
      alreadyProcessed = existing.rows[0]?.processed_at != null;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Failed to record webhook event row, aborting:', err);
    // If we can't even talk to the DB, ask Stripe to retry.
    return NextResponse.json({ error: 'Database unavailable' }, { status: 500 });
  }

  if (alreadyProcessed) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  // --- Process the event.
  try {
    await dispatchEvent(event);

    const client = await pool.connect();
    try {
      await client.query(
        `UPDATE stripe_webhook_events
         SET processed_at = now(), attempts = attempts + 1
         WHERE id = $1`,
        [event.id]
      );
    } finally {
      client.release();
    }

    return NextResponse.json({ received: true });
  } catch (error: any) {
    const errorMessage =
      error instanceof Error ? error.message : String(error ?? 'unknown error');
    console.error('Error handling webhook event:', error);

    // Increment attempts; on too many failures, move to dead-letter queue
    // and return 200 so Stripe stops retrying. Otherwise return 500 so
    // Stripe will retry with exponential backoff.
    let attempts = 0;
    try {
      const client = await pool.connect();
      try {
        const upd = await client.query(
          `UPDATE stripe_webhook_events
           SET attempts = attempts + 1, last_error = $2
           WHERE id = $1
           RETURNING attempts`,
          [event.id, errorMessage.slice(0, 2000)]
        );
        attempts = upd.rows[0]?.attempts ?? 0;

        if (attempts > MAX_ATTEMPTS) {
          await client.query(
            `INSERT INTO stripe_webhook_dlq
               (event_id, event_type, payload, signature, attempts, last_error)
             VALUES ($1, $2, $3::jsonb, $4, $5, $6)`,
            [
              event.id,
              event.type,
              JSON.stringify(event),
              sig,
              attempts,
              errorMessage.slice(0, 2000),
            ]
          );
        }
      } finally {
        client.release();
      }
    } catch (bookkeepingErr) {
      console.error('Failed to record webhook failure:', bookkeepingErr);
    }

    if (attempts > MAX_ATTEMPTS) {
      // Acknowledge so Stripe stops retrying; humans will investigate the DLQ.
      return NextResponse.json(
        { received: true, dead_lettered: true },
        { status: 200 }
      );
    }
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
