# M2 Ops Checklist — Retrain + Gate + Promote

## Prerequisites
- [ ] All D1-D10 loaders run on server and tables populated
- [ ] Backfill migration applied: `psql -f infrastructure/migrations/2026_07_11_rental_backfill_features.sql`
- [ ] Keyset backfills run (flood_sfha, transit_stops_1km on rental_listings)

## Step 1: Run Backfills
```bash
# On server, run the keyset backfills in batches of 10K
# See commented SQL in the migration file
```

## Step 2: Retrain
```bash
curl -X POST localhost:8000/ops/run-train
# Or wait for nightly scheduled training
```

## Step 3: Verify Gate
Check eval report for:
- [ ] Overall ratio: v1_mae / hud_mae <= 0.85
- [ ] High-variance non-regression
- [ ] Spearman improved
- [ ] Band coverage in [0.78, 0.84]
- [ ] fmr_cagr >= 0.5

## Step 4: Check Importances
Inspect `importances_top20` in eval report:
- [ ] `walkability_index` appears in top-20
- [ ] `zip_hpi_cagr_5yr` appears in top-20
- [ ] If all 7 new features have ~0 gain → revert batch (they're noise)

## Step 5: Promote
If gate passes:
- [ ] Model artifact promoted to active
- [ ] Update spec acceptance table in `docs/superpowers/specs/2026-07-08-rent-model-v2-final.md`

## Step 6: Deploy
```bash
./infrastructure/deploy.sh
```
