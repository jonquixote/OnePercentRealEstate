import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import pool from '@/lib/db';

// Helper function to handle checkout session completed
async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
    const userId = session.metadata?.userId;
    const customerId = session.customer as string;

    if (userId) {
        try {
            const client = await pool.connect();
            // Store subscription info in a profiles table if it exists
            await client.query(`
                INSERT INTO profiles (id, stripe_customer_id, subscription_tier, updated_at) 
                VALUES ($1, $2, 'pro', NOW())
                ON CONFLICT (id) DO UPDATE SET 
                    stripe_customer_id = $2, 
                    subscription_tier = 'pro',
                    updated_at = NOW()
            `, [userId, customerId]);
            client.release();
        } catch (error) {
            console.error('Failed to update profile:', error);
        }
    }
}

// Helper function to handle subscription updates (created, updated, deleted)
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

    try {
        const client = await pool.connect();
        await client.query(`
            UPDATE profiles 
            SET subscription_tier = $1, updated_at = NOW() 
            WHERE stripe_customer_id = $2
        `, [subscription_tier, customerId]);
        client.release();
    } catch (error) {
        console.error('Failed to update subscription:', error);
    }
}

export async function POST(req: Request) {
    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
        console.error('Stripe keys are missing');
        return NextResponse.json({ error: 'Internal Server Configuration Error' }, { status: 500 });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: '2025-11-17.clover',
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

    // Handle the event
    try {
        switch (event.type) {
            case 'checkout.session.completed':
                const session = event.data.object as Stripe.Checkout.Session;
                await handleCheckoutSessionCompleted(session);
                break;
            case 'customer.subscription.updated':
            case 'customer.subscription.deleted':
                const subscription = event.data.object as Stripe.Subscription;
                await handleSubscriptionUpdated(subscription);
                break;
            default:
                console.log(`Unhandled event type ${event.type}`);
        }
    } catch (error) {
        console.error('Error handling webhook event:', error);
        return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
    }

    return NextResponse.json({ received: true });
}
