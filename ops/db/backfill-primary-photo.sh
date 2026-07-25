#!/usr/bin/env bash
# =============================================================================
# backfill-primary-photo.sh — fill listings.primary_photo from the images jsonb.
#
# 446,437 active listings have images; 140 had the native column. Every read
# path selecting the bare column therefore rendered an imageless card. The data
# was always present — only the column was empty.
#
# Also a performance fix: `images` is TOASTed, so images->>0 costs 1.939ms/94
# buffers versus 0.119ms/58 for the native column (measured on prod).
#
# Batched/paced/resumable, same discipline as backfill-rent-bands.sh — this runs
# against the live database while the crawler writes to the same table.
# =============================================================================
set -uo pipefail

TARGET="${1:-500000}"      # max rows to fill this run
BATCH="${2:-5000}"         # rows per statement
PAUSE="${3:-20}"           # seconds between batches — leaves headroom for the crawl

if [[ -f /etc/oper.env ]]; then
  # shellcheck disable=SC1091
  set -a; . /etc/oper.env; set +a
fi
DB="${DATABASE_URL_DIRECT:-${DATABASE_URL:-}}"
[[ -z "$DB" ]] && { echo "[photo-backfill] no DATABASE_URL" >&2; exit 1; }

filled=0
while (( filled < TARGET )); do
  remain=$(( TARGET - filled ))
  lim=$(( remain < BATCH ? remain : BATCH ))

  n=$(psql "$DB" -tA -c "
    WITH batch AS (
      SELECT id FROM listings
       WHERE primary_photo IS NULL
         AND images IS NOT NULL
         AND jsonb_array_length(images) > 0
       ORDER BY id
       LIMIT ${lim}
    ), upd AS (
      UPDATE listings l
         SET primary_photo = l.images->>0
        FROM batch b
       WHERE l.id = b.id
         -- Not redundant with the CTE: prevents clobbering a value the crawler
         -- wrote between the SELECT and the UPDATE.
         AND l.primary_photo IS NULL
      RETURNING 1
    ) SELECT count(*) FROM upd;" 2>/dev/null | tr -d '[:space:]')

  if [[ -z "$n" || "$n" == "0" ]]; then
    echo "[photo-backfill] no rows left to fill"
    break
  fi
  filled=$(( filled + n ))

  # Progress count deliberately does NOT filter on jsonb_array_length(images):
  # that predicate forces a TOAST read per candidate row, which made this
  # progress counter cost more database time than the work it was reporting on
  # (observed at 75% of the window's DB time). Counting the partial-index
  # predicate alone is index-only and effectively free; it slightly overcounts
  # by including rows with no images, which is fine for a progress line.
  remaining=$(psql "$DB" -tA -c "
    SELECT count(*) FROM listings WHERE primary_photo IS NULL;" 2>/dev/null | tr -d '[:space:]')
  echo "[photo-backfill] filled ${n} (run total ${filled}/${TARGET}); remaining<=${remaining:-?}"

  (( filled < TARGET )) && sleep "$PAUSE"
done
echo "[photo-backfill] finished this run. filled ${filled}."
