"""Load LA County parcels from ArcGIS FeatureServer into the parcels table.

LA County parcels are public ArcGIS FeatureServer data. This is the reference
adapter implementation; more counties are follow-up work.

Source: https://public.gis.lacounty.gov/public/rest/services/LACounty_Cache/LACounty_Parcel/MapServer/0

Requires:
  DATABASE_URL env var
  pip install psycopg2-binary requests

Usage:
  DATABASE_URL=... python load_parcels_la.py
  DATABASE_URL=... python load_parcels_la.py --offset 120000
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.request

COUNTY_FIPS = "06037"
BASE_URL = (
    "https://public.gis.lacounty.gov/public/rest/services/"
    "LACounty_Cache/LACounty_Parcel/MapServer/0"
)
PAGE_SIZE = 1000
TIMEOUT = 120


def normalize_address(addr: str) -> str | None:
    if not addr:
        return None
    s = re.sub(r"[.,#]", "", addr.strip().lower())
    s = re.sub(r"\s+", " ", s)
    return s or None


def fetch_page(offset: int) -> list[dict]:
    params = (
        f"?f=json"
        f"&where=1%3D1"
        f"&outFields=*"
        f"&resultOffset={offset}"
        f"&resultRecordCount={PAGE_SIZE}"
        f"&outSR=4326"
    )
    url = BASE_URL + params
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        data = json.loads(resp.read())
    # ArcGIS JSON format wraps features differently than GeoJSON
    features = data.get("features", [])
    return [
        {
            "properties": f.get("attributes", {}),
            "geometry": f.get("geometry"),  # already in {rings: [[...]]} format
        }
        for f in features
    ]


def arcgis_to_geojson(geom: dict) -> dict | None:
    """Convert ArcGIS JSON geometry to GeoJSON."""
    if not geom:
        return None
    # ArcGIS returns {"rings": [...], "spatialReference": {...}}
    rings = geom.get("rings")
    if rings:
        return {"type": "Polygon", "coordinates": rings}
    # Already GeoJSON-like
    if geom.get("type") and geom.get("coordinates"):
        return geom
    return None


def main() -> None:
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("ERROR: DATABASE_URL env var required", file=sys.stderr)
        sys.exit(1)

    offset = 0
    if "--offset" in sys.argv:
        idx = sys.argv.index("--offset")
        if idx + 1 < len(sys.argv):
            offset = int(sys.argv[idx + 1])

    import psycopg2

    conn = psycopg2.connect(dsn)
    total_upserted = 0

    try:
        while True:
            print(f"  fetching offset={offset}", file=sys.stderr)
            features = fetch_page(offset)
            if not features:
                break

            rows = []
            for feat in features:
                props = feat.get("properties", {})
                apn = props.get("AIN") or props.get("APN")
                if not apn:
                    continue
                apn = str(apn).strip()
                situs = props.get("SitusFullAddress", "")
                land_val = props.get("Roll_LandValue")
                imp_val = props.get("Roll_ImpValue")
                geom_raw = feat.get("geometry")
                geom = arcgis_to_geojson(geom_raw)
                if not geom:
                    continue

                rows.append((
                    COUNTY_FIPS,
                    apn,
                    normalize_address(situs),
                    land_val if land_val else None,
                    imp_val if imp_val else None,
                    json.dumps(geom),
                ))

            if rows:
                with conn.cursor() as cur:
                    args_str = ",".join(
                        cur.mogrify(
                            "(%s,%s,%s,%s,%s,ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%s),4326))::geometry(MultiPolygon,4326))",
                            r,
                        ).decode()
                        for r in rows
                    )
                    cur.execute(
                        f"INSERT INTO parcels (county_fips, apn, situs_addr_norm, assessed_land, assessed_improvements, geom) "
                        f"VALUES {args_str} "
                        f"ON CONFLICT (county_fips, apn) DO UPDATE SET "
                        f"situs_addr_norm = EXCLUDED.situs_addr_norm, "
                        f"assessed_land = EXCLUDED.assessed_land, "
                        f"assessed_improvements = EXCLUDED.assessed_improvements, "
                        f"geom = EXCLUDED.geom"
                    )
                conn.commit()

            total_upserted += len(rows)
            offset += PAGE_SIZE
            print(
                json.dumps({"progress": True, "offset": offset, "batch": len(rows), "total": total_upserted}),
                file=sys.stderr,
            )

    finally:
        conn.close()

    print(json.dumps({"done": True, "rows": total_upserted}))


if __name__ == "__main__":
    main()
