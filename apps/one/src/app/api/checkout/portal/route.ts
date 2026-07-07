import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getSessionUser } from '@/lib/auth';
import pool from '@/lib/db';

export async function POST(req: Request) {
    if (!process.env.STRIPE_SECRET_KEY) {
        return NextResponse.json({ error: 'Not configured' }, { status: 500 });
    }

    const sessionUser = await getSessionUser();
    if (!sessionUser) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const client = await pool.connect();
        let stripeCustomerId: string | null = null;
        try {
            const result = await client.query(
                'SELECT stripe_customer_id FROM profiles WHERE id = $1',
                [sessionUser.id]
            );
            stripeCustomerId = result.rows[0]?.stripe_customer_id ?? null;
        } finally {
            client.release();
        }

        if (!stripeCustomerId) {
            return NextResponse.json({ error: 'No subscription found' }, { status: 400 });
        }

        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
            apiVersion: '2026-02-25.clover',
        });

        const session = await stripe.billingPortal.sessions.create({
            customer: stripeCustomerId,
            return_url: `${req.headers.get('origin') || process.env.NEXT_PUBLIC_SITE_URL || 'https://one.octavo.press'}/account`,
        });

        return NextResponse.json({ url: session.url });
    } catch (err: any) {
        console.error('Stripe Portal Error:', err);
        return NextResponse.json({ error: 'Failed to create portal session' }, { status: 500 });
    }
}
