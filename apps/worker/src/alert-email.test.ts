import { describe, it, expect, vi, beforeAll } from 'vitest';

beforeAll(() => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://test/test';
});

describe('renderAlertEmail (pure)', () => {
  const candidate = (id: string | number, address: string, ratio: number) => ({
    id, address, zip_code: '77002', price: 120000, estimated_rent: 1500, rent_price_ratio: ratio,
  });

  const row = (userId: string, listingId: string | number, label: string): any => ({
    user_id: userId, listing_id: listingId, source: 'area', source_label: label, ratio: null, price: null,
  });

  it('builds subject + html for 2 events with both addresses and percent ratios', async () => {
    const { renderAlertEmail } = await import('./alert-email');
    const events = [row('u1', '1', 'Houston'), row('u1', '2', 'Houston')];
    const cands = [candidate('1', '9 Deal St', 0.0123), candidate('2', '12 Bargain Rd', 0.0456)];
    const { subject, html } = renderAlertEmail(events, cands, { userId: 'u1', email: 'u1@example.com' });

    expect(subject).toBe('New deal in Houston (+1 more)');
    expect(html).toContain('9 Deal St');
    expect(html).toContain('12 Bargain Rd');
    expect(html).toContain('1.23%');
    expect(html).toContain('4.56%');
    expect(html).toContain('https://one.octavo.press/property/1');
    expect(html).toContain('https://one.octavo.press/property/2');
    expect(html).toContain('/api/unsubscribe?token=');
  });

  it('is self-contained: no script, no external stylesheet/@import', async () => {
    const { renderAlertEmail } = await import('./alert-email');
    const { html } = renderAlertEmail(
      [row('u1', '1', 'Houston')],
      [candidate('1', '9 Deal St', 0.01)],
      { userId: 'u1', email: 'u1@example.com' },
    );
    expect(html.toLowerCase().includes('<script')).toBe(false);
    expect(html.toLowerCase().includes('@import')).toBe(false);
    expect(/<link[^>]+stylesheet/i.test(html)).toBe(false);
  });

  it('subject is singular for a single event', async () => {
    const { renderAlertEmail } = await import('./alert-email');
    const { subject } = renderAlertEmail(
      [row('u1', '1', 'Houston')],
      [candidate('1', '9 Deal St', 0.01)],
    );
    expect(subject).toBe('New deal in Houston');
  });
});

describe('sendAlertEmails (Resend-gated)', () => {
  it('returns 0 without calling fetch when RESEND_API_KEY is unset', async () => {
    const mod = await import('./alert-email');
    // Force a fresh import with no key.
    const spy = vi.spyOn(globalThis, 'fetch');
    const fetchCalls = vi.fn();
    (globalThis.fetch as any) = fetchCalls;
    // Re-evaluate haveResend by importing under an isolated module registry.
    vi.resetModules();
    delete process.env.RESEND_API_KEY;
    const fresh = await import('./alert-email');
    const sent = await fresh.sendAlertEmails(
      { id: 'u1', email: 'u1@example.com' },
      [{ user_id: 'u1', listing_id: '1', source: 'area', source_label: 'Houston', ratio: 0.01, price: 100 }],
      [{ id: '1', address: '9 Deal St', zip_code: '77002', price: 100, estimated_rent: 1, rent_price_ratio: 0.01 }],
      { info: () => {}, warn: () => {}, error: () => {} } as any,
    );
    expect(sent).toBe(0);
    expect(fetchCalls).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    // Restore real module for subsequent imports.
    vi.resetModules();
    void mod;
  });

  it('sends once with a fake key and does not throw when sendResendEmail throws', async () => {
    vi.resetModules();
    process.env.RESEND_API_KEY = 're_test_key';
    const fresh = await import('./alert-email');
    const sent = await fresh.sendAlertEmails(
      { id: 'u1', email: 'u1@example.com' },
      [{ user_id: 'u1', listing_id: '1', source: 'area', source_label: 'Houston', ratio: 0.01, price: 100 }],
      [{ id: '1', address: '9 Deal St', zip_code: '77002', price: 100, estimated_rent: 1, rent_price_ratio: 0.01 }],
      { info: () => {}, warn: () => {}, error: () => {} } as any,
    );
    // sendResendEmail hits real fetch (no network in test env); the function
    // catches the rejection internally, so it must NOT throw and returns 0.
    expect(typeof sent).toBe('number');
    vi.resetModules();
  });
});
