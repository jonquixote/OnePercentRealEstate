-- 2026_06_02: Stripe webhook idempotency + dead-letter queue
-- Stripe re-sends webhooks on retry; we must process each event at most once.
-- Safe to re-run: uses CREATE TABLE / CREATE INDEX IF NOT EXISTS guards.

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id TEXT PRIMARY KEY,                    -- Stripe event.id (evt_*)
  type TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_received
  ON stripe_webhook_events (received_at DESC);

-- Events we couldn't handle after N retries land here for human review.
CREATE TABLE IF NOT EXISTS stripe_webhook_dlq (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  signature TEXT,
  failed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INTEGER NOT NULL,
  last_error TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_dlq_failed
  ON stripe_webhook_dlq (failed_at DESC);
