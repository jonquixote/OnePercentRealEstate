# Stripe test-mode loop (Growth Phase 1.2)

Verified green run of the full subscription loop against Stripe **test mode**,
confirming webhook signature verification is ON and the paid gate
(Compare >2) unlocks/downgrades correctly.

## Prereqs (must all be true on the server in `/etc/oper.env`)

- `STRIPE_SECRET_KEY=sk_test_…` (test mode — live keys would charge real cards)
- `STRIPE_PUBLISHABLE_KEY=pk_test_…` (baked into the client at build time via `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`)
- `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_ANNUAL` = valid `price_…` IDs in the test account
- `STRIPE_WEBHOOK_SECRET=whsec_…` = the **real** test-mode signing secret

> **RESOLVED (2026-07-11):** `STRIPE_WEBHOOK_SECRET` was a placeholder
> (`…PLACEHOLDER_GET_FROM_STRIPE_DASHBOARD`) so signature checks failed with
> `400 Webhook Error`. For the test loop we ran the Stripe CLI locally and
> forwarded events to the **public** server URL (the app runs on the server,
> not localhost): `stripe listen --forward-to https://one.octavo.press/api/webhooks`.
> The printed `whsec_…` was written into `/etc/oper.env` (and `/opt/onepercent/.env`)
> and `oper-app` restarted. **For production** replace it with the real
> dashboard signing secret (below).

## Get the signing secret

Stripe Dashboard → Developers → Webhooks → (the `one.octavo.press/api/webhooks`
endpoint, **test mode**) → "Reveal signing secret" → copy the `whsec_…` value.

For the test loop on this deploy (app runs on the remote server), use the
Stripe CLI locally and forward to the public URL — no dashboard secret needed:

```bash
# local machine (Stripe CLI logged in, full sk_test_ key exported):
export STRIPE_API_KEY=sk_test_…      # CLI ignores the local rk_ restricted key
stripe listen --forward-to https://one.octavo.press/api/webhooks   # prints whsec_…
# copy the printed whsec_… into /etc/oper.env + /opt/onepercent/.env, then:
ssh root@209.94.61.108 'systemctl restart oper-app'
```

> The CLI's saved key is a **restricted** key (`rk_test_…`) which `stripe listen`
> rejects — export the full `sk_test_…` (same Stripe account as the server) when
> running `listen`/`trigger`.

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

## Verified run (2026-07-11)

Executed headlessly against the live server using `stripe listen` →
`https://one.octavo.press/api/webhooks` + `stripe trigger` / `stripe` CLI calls:

1. `stripe trigger customer.created` → server logged `<-- [200]` (signature OK;
   a bad secret would have returned `400 Webhook Error`).
2. Created a Stripe test customer (attached `tok_visa`), linked a DB `profiles`
   row via `stripe_customer_id`, then `stripe subscriptions create …` →
   `customer.subscription.created` (status `active`) forwarded → **tier became
   `pro`**.
3. `stripe subscriptions cancel …` → `customer.subscription.deleted` forwarded →
   **tier reverted to `free`**.
4. Events recorded once each in `stripe_webhook_events` (idempotent).

> **BUG FIX (commit `860506b`):** the webhook handler only switched on
> `customer.subscription.updated` / `.deleted` and **ignored
> `.created`**. A brand-new active subscription therefore never granted `pro`
> (Stripe test mode fires `.created` without a follow-up `.updated`). Added
> `customer.subscription.created` to the same case so initial subscribe grants
> `pro`. Re-deployed and re-tested — grant now fires on `.created`.

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
