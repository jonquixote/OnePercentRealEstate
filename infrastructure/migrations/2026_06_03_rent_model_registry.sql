-- Wave 3: Rent model registry + per-prediction audit log.
--
-- Today every rent estimate is anonymous: the value lands in
-- listings.estimated_rent with no record of which version of the math
-- produced it. That makes the eval harness and drift monitor impossible to
-- close the loop on.
--
-- This migration introduces two tables:
--
--   rent_models
--     Catalog of trained rent estimators. Exactly one row is `active=true`
--     at a time (enforced by a partial unique index). The FastAPI shim in
--     `services/ml/main.py` reads the active version on every prediction and
--     stamps it onto the listing via the Node worker.
--
--   rent_predictions_audit
--     Append-only log of (listing_id, model_version, predicted_rent,
--     features, created_at). Optional shadow_version / shadow_predicted_rent
--     columns hold a parallel score from a candidate model during a
--     promotion gate, so we can diff before flipping `active`.
--
-- A baseline row `v0` is seeded as active so any prediction written
-- immediately after the migration applies has a real version to stamp.
-- The seed is idempotent (`ON CONFLICT DO NOTHING`).

BEGIN;

CREATE TABLE IF NOT EXISTS rent_models (
    id BIGSERIAL PRIMARY KEY,
    version TEXT NOT NULL UNIQUE,
    trained_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    feature_set_hash TEXT,
    metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
    artifact_path TEXT,
    active BOOLEAN NOT NULL DEFAULT false,
    promoted_at TIMESTAMPTZ,
    notes TEXT
);

-- At most one active model. Partial unique index makes this a constraint
-- rather than something we have to enforce in app code.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rent_models_one_active
    ON rent_models (active) WHERE active = true;

CREATE TABLE IF NOT EXISTS rent_predictions_audit (
    id BIGSERIAL PRIMARY KEY,
    listing_id BIGINT REFERENCES listings(id) ON DELETE CASCADE,
    model_version TEXT NOT NULL,
    predicted_rent NUMERIC(10,2) NOT NULL,
    features JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    shadow_version TEXT,
    shadow_predicted_rent NUMERIC(10,2)
);

CREATE INDEX IF NOT EXISTS idx_rent_predictions_audit_listing
    ON rent_predictions_audit (listing_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rent_predictions_audit_version
    ON rent_predictions_audit (model_version, created_at DESC);

-- Seed v0 as the active baseline. Represents the in-DB triangulation that
-- ran via `set_smart_rent_estimate` before this wave; the Wave 3 worker
-- temporarily delegates to the same Python triangulation behind the
-- FastAPI shim, so v0 is also what fresh writes get stamped with until a
-- distinct trained model is registered.
INSERT INTO rent_models (version, metrics, active, notes)
VALUES (
    'v0',
    '{"source": "legacy_trigger", "method": "weighted_triangulation"}'::jsonb,
    true,
    'Pre-Wave-3 in-DB triangulation. Replaced by services/ml/ async worker.'
)
ON CONFLICT (version) DO NOTHING;

COMMIT;
