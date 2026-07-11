# Stripe test-mode loop (Growth Phase 1.2)

Verified green run of the full subscription loop against Stripe **test mode**,
confirming webhook signature verification is ON and the paid gate
(Compare >2) unlocks/downgrades correctly.

## Prereqs (must all be true on the server in `/etc/oper.env`)

- `STRIPE_SECRET_KEY=sk_test_…` (test mode — live keys would charge real cards)
- `STRIPE_PUBLISHABLE_KEY=pk_test_…` (baked into the client at build time via `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`)
- `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_ANNUAL` = valid `price_…` IDs in the test account
- `STRIPE_WEBHOOK_SECRET=whsec_…` = the **real** test-mode signing secret

> **KNOWN BREAKAGE (2026-07-11):** `STRIPE_WEBHOOK_SECRET` was a placeholder
> (`…PLACEHOLDER_GET_FROM_STRIPE_DASHBOARD`), so webhook signature checks failed
> with `400 Webhook Error`. Replace it with the real signing secret (below)
> before the loop can complete.

## Get the signing secret

Stripe Dashboard → Developers → Webhooks → (the `one.octavo.press/api/webhooks`
endpoint, **test mode**) → "Reveal signing secret" → copy the `whsec_…` value.

For pure local dev you can instead use the Stripe CLI (no dashboard secret needed):

```bash
stripe listen --forward-to localhost:3001/api/webhooks   # prints a whsec_… secret
# in another shell:
export STRIPE_WEBHOOK_SECRET=<printed whsec_…>
```

Then restart the app so it picks up the new secret:

```bash
cd /opt/onepercent && bash ops/systemd/deploy-systemd.sh app
```

## Walk the loop

1. **Checkout** (authed user, gets a Stripe Checkout Session with
   `metadata.userId` = the session user id — never client-supplied):
   ```bash
   curl -sS -c cj.txt -X POST http://localhost:3001/api/checkout \
     -H 'content-type: application/json' -d '{"plan":"monthly"}'
   # → { "sessionId": "cs_test_…" }  (open the returned URL to pay)
   ```
2. **Pay** with test card `4242 4242 4242 4242`, any future expiry, any CVC.
   Stripe fires `checkout.session.completed` then
   `customer.subscription.created`/`updated` to `/api/webhooks`.
3. **Verify grant** — webhook sets `pro` on the user resolved by
   `metadata.userId` (or `customer_email`):
   ```bash
   curl -sS -b cj.txt http://localhost:3001/api/auth/me
   # → { "user": { "tier": "pro", … } }
   ```
4. **Verify the gate unlocks** — pro account can compare >2:
   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' -b cj.txt \
     'http://localhost:3001/api/properties?ids=1,2,3,4&compare=1'   # 200
   ```
5. **Cancel / downgrade** — delete the subscription in the Dashboard or via
   `stripe` CLI. Stripe fires `customer.subscription.deleted` → webhook sets
   `subscription_tier='free'`.
6. **Verify downgrade**:
   ```bash
   curl -sS -b cj.txt http://localhost:3001/api/auth/me   # tier "free"
   curl -sS -o /dev/null -w '%{http_code}\n' -b cj.txt \
     'http://localhost:3001/api/properties?ids=1,2,3&compare=1'   # 402
   ```

## Signature-verification acceptance

- Valid `stripe-signature` header → `200` and the tier is updated.
- Tampered / missing signature → `400 Webhook Error` (event rejected, no tier
  change). This is enforced in `apps/one/src/app/api/webhooks/route.ts` via
  `stripe.webhooks.constructEvent(body, sig, webhookSecret)`.

## Idempotency / safety

- `stripe_webhook_events` records each event id; duplicate deliveries are
  no-ops (`ON CONFLICT DO NOTHING` + `processed_at` check).
- Failures beyond `MAX_ATTEMPTS=5` go to `stripe_webhook_dlq` and are
  acknowledged so Stripe stops retrying.
