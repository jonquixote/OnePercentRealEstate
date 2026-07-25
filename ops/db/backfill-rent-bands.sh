#!/usr/bin/env bash
# =============================================================================
# backfill-rent-bands.sh — recompute rent confidence bands for legacy listings.
#
# WHY: 261,758 active rentable listings (65%) had an `estimated_rent` but NO
# `rent_low`/`rent_high`. Audit (2026-07-28) showed this is purely LEGACY: rows
# estimated before bands were wired into the write path. Verified by calling the
# live ML service with one such listing — it returns a band today:
#   {"predicted_rent":2021.57,"rent_low":1625.08,"rent_high":2321.36}
# So the fix is simply to re-enqueue them through the EXISTING estimator queue.
#
# The bands matter: apps/one/src/lib/rent-trust.ts grades an estimate
# trusted|wide|implausible, and the deal page shows a p10-p90 band. Without one
# we present a single confident-looking number we cannot qualify.
#
# SAFETY
#   - Uses the existing queue (rent_calc_status='pending'), never a side path,
#     so pacing, retries and the audit trail all still apply.
#   - Bounded batches with a pause between them so the estimator never starves
#     the crawler and the DB load budget is not tripped.
#   - Idempotent + resumable: it selects only rows that still lack a band, so
#     re-running continues where it left off. Ctrl-C is safe.
#   - Skips rows with no lat/lon (they legitimately fail: "missing lat/lon").
#
# Usage:  bash ops/db/backfill-rent-bands.sh [total] [batch] [sleep_s]
# =============================================================================
set -uo pipefail

TOTAL="${1:-50000}"      # how many to enqueue this run
BATCH="${2:-5000}"       # per tranche
PAUSE="${3:-60}"         # seconds between tranches (let the estimator drain)

if [[ -f /etc/oper.env ]]; then
  # shellcheck disable=SC1091
  set -a; . /etc/oper.env; set +a
fi
DB="${DATABASE_URL_DIRECT:-${DATABASE_URL:-}}"
[[ -z "$DB" ]] && { echo "no DATABASE_URL" >&2; exit 1; }

remaining() {
  psql "$DB" -tAc "SELECT count(*) FROM listings
                    WHERE listing_status='active' AND estimated_rent > 0
                      AND rent_low IS NULL AND public.is_rentable(property_type)
                      AND latitude IS NOT NULL" | tr -d '[:space:]'
}

echo "[backfill] unbanded remaining: $(remaining)"
done_count=0
while [[ $done_count -lt $TOTAL ]]; do
  # Wait for the queue to drain before adding more — this is what keeps the
  # backfill from competing with live crawl ingestion.
  pending=$(psql "$DB" -tAc "SELECT count(*) FROM listings WHERE rent_calc_status='pending'" | tr -d '[:space:]')
  if [[ "${pending:-0}" -gt $((BATCH / 2)) ]]; then
    echo "[backfill] queue busy (${pending} pending) — waiting ${PAUSE}s"
    sleep "$PAUSE"
    continue
  fi

  n=$(psql "$DB" -tAc "
    WITH t AS (
      SELECT id FROM listings
       WHERE listing_status='active' AND estimated_rent > 0
         AND rent_low IS NULL AND public.is_rentable(property_type)
         AND latitude IS NOT NULL
       ORDER BY id LIMIT ${BATCH}
    )
    UPDATE listings l SET rent_calc_status='pending' FROM t WHERE l.id = t.id
    RETURNING 1" | grep -c 1)

  [[ "${n:-0}" -eq 0 ]] && { echo "[backfill] nothing left to enqueue"; break; }
  done_count=$((done_count + n))
  echo "[backfill] enqueued ${n} (run total ${done_count}/${TOTAL}); unbanded left: $(remaining)"
  sleep "$PAUSE"
done

echo "[backfill] finished this run. unbanded remaining: $(remaining)"
