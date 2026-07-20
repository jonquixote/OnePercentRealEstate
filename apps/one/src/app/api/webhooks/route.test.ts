import { describe, it, expect, vi, beforeEach } from 'vitest';
import Stripe from 'stripe';

/* eslint-disable @typescript-eslint/no-explicit-any */
const { query } = vi.hoisted(() => ({
  query: vi.fn(async (text: string): Promise<any> => {
    if (text.includes('ON CONFLICT (id)') || text.includes('ON CONFLICT (stripe_customer_id)') || text.startsWith('UPDATE profiles') || text.startsWith('INSERT INTO profiles')) {
      return { rows: [{ id: 'profile-existing' }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }),
}));

vi.mock('@/lib/db', () => ({
  default: { connect: vi.fn(async () => ({ query, release: vi.fn() })) },
}));

import { dispatchEvent } from './handler';

function makeSession(userId: string | undefined, customerId: string, email?: string): Stripe.Checkout.Session {
  return {
    object: 'checkout.session',
    id: 'cs_test',
    metadata: userId ? { userId } : {},
    customer: customerId,
    customer_email: email,
    customer_details: email ? { email } : null,
  } as unknown as Stripe.Checkout.Session;
}

describe('webhook checkout.session.completed', () => {
  beforeEach(() => {
    query.mockClear();
  });

  it('resolves to the metadata.userId profile (no duplicate) and writes stripe_customer_id + pro', async () => {
    // Profile exists but has NO stripe_customer_id yet (first-time buyer).
    query.mockImplementation(async (text: string, params?: unknown[]) => {
      if (text.startsWith('SELECT id FROM profiles WHERE id = $1')) {
        return { rows: [{ id: params![0] }], rowCount: 1 };
      }
      if (text.startsWith('SELECT id FROM profiles WHERE id <> $1')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.startsWith('INSERT INTO profiles') || text.startsWith('UPDATE profiles')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await dispatchEvent({
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: { object: makeSession('profile-existing', 'cus_brand_new', 'buyer@x.co') },
    } as unknown as Stripe.Event);

    // No SELECT-by-email fallback should have run (resolved by id first).
    const emailLookups = (query.mock.calls as any[]).filter((c: unknown[]) => String(c[0]).includes('WHERE email = $1'));
    expect(emailLookups.length).toBe(0);

    // The UPSERT-by-id must have written both stripe_customer_id and pro tier.
    const writeCall = (query.mock.calls as any[]).find((c: unknown[]) => String(c[0]).includes('ON CONFLICT (id) DO UPDATE'));
    expect(writeCall).toBeTruthy();
    const boundParams = writeCall![1] as unknown[];
    expect(boundParams[0]).toBe('profile-existing');
    expect(boundParams[1]).toBe('cus_brand_new'); // stripe_customer_id persisted
  });

  it('does not create a duplicate when the customer id is already owned by another profile', async () => {
    query.mockImplementation(async (text: string, params?: unknown[]) => {
      if (text.startsWith('SELECT id FROM profiles WHERE id = $1')) {
        return { rows: [{ id: params![0] }], rowCount: 1 };
      }
      if (text.startsWith('SELECT id FROM profiles WHERE id <> $1')) {
        // conflict: another profile already owns this customer id
        return { rows: [{ id: 'other-owner' }], rowCount: 1 };
      }
      if (text.startsWith('SELECT id FROM profiles WHERE email = $1')) {
        return { rows: [{ id: 'profile-by-email' }], rowCount: 1 };
      }
      if (text.startsWith('INSERT INTO profiles') || text.startsWith('UPDATE profiles')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await dispatchEvent({
      id: 'evt_2',
      type: 'checkout.session.completed',
      data: { object: makeSession('profile-existing', 'cus_dup', 'buyer@x.co') },
    } as unknown as Stripe.Event);

    // Attach to the existing owner — no email fallback, no new profile.
    const emailLookups = (query.mock.calls as any[]).filter((c: unknown[]) => String(c[0]).includes('WHERE email = $1'));
    expect(emailLookups.length).toBe(0);

    const writeCall = (query.mock.calls as any[]).find((c: unknown[]) => String(c[0]).includes('ON CONFLICT (id) DO UPDATE'));
    expect(writeCall).toBeTruthy();
    expect((writeCall![1] as unknown[])[0]).toBe('other-owner');
  });
});
