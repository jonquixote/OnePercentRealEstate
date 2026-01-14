import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// Helper function to get admin client
function getSupabaseAdmin() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
}

// Helper function to handle checkout session completed
async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
    const userId = session.metadata?.userId;
    const customerId = session.customer as string;

    if (userId) {
        const supabaseAdmin = getSupabaseAdmin();
        await supabaseAdmin
            .from('profiles')
            .update({
                stripe_customer_id: customerId,
                subscription_tier: 'pro'
            })
            .eq('id', userId);
    }
}

// Helper function to handle subscription updates (created, updated, deleted)
async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
    const customerId = subscription.customer as string;
    const status = subscription.status;

    let subscription_tier: 'free' | 'pro' | null = null;

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

    const supabaseAdmin = getSupabaseAdmin();
    await supabaseAdmin
        .from('profiles')
        .update({ subscription_tier: subscription_tier })
        .eq('stripe_customer_id', customerId);
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
