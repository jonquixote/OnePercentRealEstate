#!/bin/bash
# Download TIGER/Line 2024 census-tract shapefiles for all 50 states + DC,
# load them into the PostGIS container via shp2pgsql, and INSERT into
# census_tracts.
#
# Prerequisites: docker compose with postgis service running.
#
# Usage:  bash infrastructure/scripts/load-census-tracts.sh
#
# Runs inside the postgres container via docker exec. shp2pgsql ships in
# the postgis/postgis:16-3.4-alpine image.
#
# About 85K tracts across 51 files. Total download ~1.5 GB extracted;
# each extracted zip is cleaned up after loading.

set -euo pipefail

cd "$(dirname "$0")/../.."

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

CONTAINER="infrastructure-postgres-1"

# All 50 states + DC by FIPS code
STATES=(
  # Format: FIPS:name
  "01:alabama" "02:alaska" "04:arizona" "05:arkansas" "06:california"
  "08:colorado" "09:connecticut" "10:delaware" "11:districtofcolumbia"
  "12:florida" "13:georgia" "15:hawaii" "16:idaho" "17:illinois"
  "18:indiana" "19:iowa" "20:kansas" "21:kentucky" "22:louisiana"
  "23:maine" "24:maryland" "25:massachusetts" "26:michigan" "27:minnesota"
  "28:mississippi" "29:missouri" "30:montana" "31:nebraska" "32:nevada"
  "33:newhampshire" "34:newjersey" "35:newmexico" "36:newyork" "37:northcarolina"
  "38:northdakota" "39:ohio" "40:oklahoma" "41:oregon" "42:pennsylvania"
  "44:rhodeisland" "45:southcarolina" "46:southdakota" "47:tennessee" "48:texas"
  "49:utah" "50:vermont" "51:virginia" "53:washington" "54:westvirginia"
  "55:wisconsin" "56:wyoming"
)

# Alpine postgis ships a shp2pgsql linked against libintl.so.8 without the
# library present (discovered 2026-07-07: every state "loaded" while the
# pipeline died silently behind 2>/dev/null). Self-heal:
docker exec "$CONTAINER" sh -c "apk add --no-cache gettext-libs libintl >/dev/null 2>&1 || apk add --no-cache gettext >/dev/null 2>&1" || true
docker exec "$CONTAINER" sh -c "shp2pgsql 2>&1 | head -1" | grep -qi usage || { echo "FATAL: shp2pgsql still broken in container"; exit 1; }

echo "Downloading and loading census tract shapefiles..."
echo "Working directory: $WORKDIR"

for entry in "${STATES[@]}"; do
  FIPS="${entry%%:*}"
  NAME="${entry##*:}"
  ZIP="tl_2024_${FIPS}_tract.zip"
  URL="https://www2.census.gov/geo/tiger/TIGER2024/TRACT/${ZIP}"
  SHAPEFILE="tl_2024_${FIPS}_tract.shp"

  echo "--- ${FIPS}: ${NAME} ---"

  # Download
  if ! curl -sL -o "$WORKDIR/$ZIP" "$URL"; then
    echo "  WARN: download failed (curl exit $?), skipping"
    continue
  fi

  # Extract
  if ! unzip -q -o "$WORKDIR/$ZIP" -d "$WORKDIR/${FIPS}" 2>/dev/null; then
    echo "  WARN: extract failed, skipping"
    rm -f "$WORKDIR/$ZIP"
    continue
  fi
  rm "$WORKDIR/$ZIP"

  # Copy into container
  docker cp "$WORKDIR/${FIPS}" "$CONTAINER:/tmp/tract_${FIPS}" 2>/dev/null

  # Run shp2pgsql then INSERT inside the container
  docker exec "$CONTAINER" sh -c "
    shp2pgsql -d -s 4269:4326 -I /tmp/tract_${FIPS}/${SHAPEFILE} staging_tracts 2>/tmp/shp_err_${FIPS} | psql -U postgres -q || echo \"  ERROR: shp2pgsql/psql failed for ${FIPS}: \$(tail -1 /tmp/shp_err_${FIPS})\"
    psql -U postgres -c \"
      INSERT INTO census_tracts (geoid, state_fips, geom)
      SELECT geoid, LEFT(geoid, 2), geom
      FROM staging_tracts
      ON CONFLICT (geoid) DO NOTHING;
    \" || echo \"  ERROR: insert failed for ${FIPS}\"
    psql -U postgres -c \"DROP TABLE IF EXISTS staging_tracts;\"
    rm -rf /tmp/tract_${FIPS}
  "

  # Clean up local copy
  rm -rf "$WORKDIR/${FIPS}"
  echo "  loaded tracts for ${NAME}"
done

# Verify
COUNT=$(docker exec "$CONTAINER" psql -U postgres -t -A -c "SELECT count(*) FROM census_tracts;")
echo "Done. census_tracts row count: $COUNT"
