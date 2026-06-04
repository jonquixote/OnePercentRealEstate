# services/ml

FastAPI shim around the rent estimator + companion CLIs for model
evaluation and drift detection.

This service is the async counterpart to the legacy in-DB
`set_smart_rent_estimate` trigger that Wave 3 removed. The Node worker
at `apps/worker/src/rent-estimator.ts` POSTs listing payloads here; the
shim runs the existing weighted triangulation from
`services/rent_estimator_v2.py` and returns a predicted rent plus the
active model version (read from the `rent_models` table).

## Endpoints

- `GET /healthz` — liveness + estimator import status.
- `POST /predict` — body: `{ listing_id, address, city, state, zip_code,
  bedrooms, bathrooms, sqft, year_built, latitude, longitude,
  property_type }`. Returns `{ predicted_rent, model_version,
  features_hash }`.

## CLIs

```
python -m services.ml.eval --holdout 0.1            # writes services/ml/reports/eval-<ts>.md
python -m services.ml.drift --days 7                # writes services/ml/reports/drift-<ts>.md; exits 1 if PSI > 0.2
```

Both expect `DATABASE_URL` in the environment.

## Local smoke

```
cd /Users/johnny/Code/OnePercentRealEstate
python -c "import services.ml.main"
```

Imports cleanly even without the FastAPI/psycopg2 stack installed if you
only need to typecheck — but the endpoint will of course need the full
requirements to actually serve.
