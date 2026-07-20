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

    // PRIMARY: resolve by metadata.userId directly against profiles.id.
    // First-time buyers have no stripe_customer_id yet, so we must NOT
    // gate on its presence — doing so spawned orphan duplicate profiles
    // and left the real user stuck on the free tier.
    if (metadataUserId) {
      const byId = await client.query(
        `SELECT id FROM profiles WHERE id = $1 LIMIT 1`,
        [metadataUserId]
      );
      if (byId.rowCount && byId.rowCount > 0) {
        const conflict = await client.query(
          `SELECT id FROM profiles WHERE id <> $1 AND stripe_customer_id = $2 LIMIT 1`,
          [metadataUserId, customerId]
        );
        if (conflict.rowCount) {
          // The customer id is already owned by a *different* profile (rare
          // race / stale metadata). Attach to that existing owner rather than
          // spinning up a second orphan profile.
          resolvedUserId = conflict.rows[0].id;
        } else {
          resolvedUserId = metadataUserId;
        }
      }
    }

    // FALLBACK: no metadata.userId — match by email, else insert a new profile.
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
      // Resolved (by id or email): UPSERT stripe_customer_id + pro tier onto
      // the existing profile. This is the critical fix — the webhook MUST
      // persist stripe_customer_id, since the billing-portal route reads it.
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
    case 'past_due':
    case 'paused':
      // Retain Pro through dunning/pause: Stripe still intends these as
      // subscribed. Stripping entitlements mid-pause/past_due would punish a
      // customer who can still pay and erode trust. Only terminal states
      // (canceled/unpaid/incomplete) and deletion drop them to free.
      subscription_tier = 'pro';
      break;
    case 'canceled':
    case 'unpaid':
    case 'incomplete':
      subscription_tier = 'free';
      break;
    default:
      console.warn(`Unhandled subscription status: ${status}`);
      return;
  }

  const client = await pool.connect();
  try {
    // Only ever attach to an existing profile by its Stripe customer id —
    // never synthesize a new profile here. The profile (and its real id) is
    // created/resolved by handleCheckoutSessionCompleted, which runs on
    // checkout.session.completed. A first-time subscription.created that
    // arrives before that event simply no-ops here and is reconciled when the
    // checkout event lands. This preserves the single-writer invariant: the
    // webhook never creates orphan profiles with random ids.
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

export { dispatchEvent, MAX_ATTEMPTS };
