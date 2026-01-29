import { NextResponse } from 'next/server';
import Stripe from 'stripe';

// Simplified checkout route without Supabase auth
// Authentication check removed - all users have access
export async function POST(req: Request) {
    if (!process.env.STRIPE_SECRET_KEY) {
        console.error('STRIPE_SECRET_KEY is missing');
        return NextResponse.json({ error: 'Internal Server Configuration Error' }, { status: 500 });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: '2025-11-17.clover',
    });

    try {
        const body = await req.json();
        const { priceId, propertyId, userId, email } = body;

        if (!priceId) {
            return NextResponse.json({ error: 'Missing priceId' }, { status: 400 });
        }

        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            payment_method_types: ['card'],
            customer_email: email || undefined,
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                },
            ],
            success_url: `${req.headers.get('origin')}/?upgrade_success=true&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${req.headers.get('origin')}/pricing?canceled=true`,
            metadata: {
                propertyId: propertyId || '',
                userId: userId || '',
            },
        });

        return NextResponse.json({ sessionId: session.id });
    } catch (err: any) {
        console.error('Stripe Checkout Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
