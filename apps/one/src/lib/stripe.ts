import { loadStripe, type Stripe } from '@stripe/stripe-js';

// Make sure to call `loadStripe` outside of a component’s render to avoid
// recreating the `Stripe` object on every render.
//
// Guarded: NEXT_PUBLIC_* is baked at build time — if the key is absent from
// the build environment we resolve null (checkout button disables) instead
// of throwing in every consumer's console.
const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise: Promise<Stripe | null> = key ? loadStripe(key) : Promise.resolve(null);

export default stripePromise;
