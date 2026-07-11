"""Load FEMA NFHL flood zone polygons into the flood_zones table.

Uses ogr2ogr (GDAL) to import S_FLD_HAZ_AR from the NFHL GDB per state,
filtered to SFHA polygons only. Downloads state-level NFHL zips from FEMA.

Requirements:
  - ogr2ogr installed (apt install gdal-bin)
  - DATABASE_URL env var

Usage:
  DATABASE_URL=... python load_nfhl.py
  DATABASE_URL=... python load_nfhl.py --state-fips 06   # single state
"""
from __future__ import annotations

import glob as globmod
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

# Safety floor (GB free required before loading). Override with MIN_FREE_GB
# when the VPS is tight but you've confirmed headroom for the temp extract
# (e.g. after the parcels load finishes and free space is < 30 GB).
MIN_FREE_GB = int(os.environ.get("MIN_FREE_GB", "30"))


def _check_disk(path: str = "/") -> None:
    usage = shutil.disk_usage(path)
    free_gb = usage.free / (1024 ** 3)
    if free_gb < MIN_FREE_GB:
        print(
            json.dumps({"done": False, "error": f"insufficient disk: {free_gb:.1f}GB free, need {MIN_FREE_GB}GB"}),
            file=sys.stderr,
        )
        sys.exit(1)


def _check_ogr2ogr() -> None:
    if shutil.which("ogr2ogr") is None:
        print(
            "ERROR: ogr2ogr not found. Install via: apt install gdal-bin",
            file=sys.stderr,
        )
        sys.exit(1)


def _parse_pg_dsn(dsn: str) -> dict[str, str]:
    """Parse a postgres:// URL into a dict of PG connection params."""
    # DATABASE_URL can be postgres:// or postgresql://
    from urllib.parse import urlparse

    parsed = urlparse(dsn)
    params: dict[str, str] = {}
    if parsed.hostname:
        params["host"] = parsed.hostname
    if parsed.port:
        params["port"] = str(parsed.port)
    if parsed.username:
        params["user"] = parsed.username
    if parsed.password:
        params["password"] = parsed.password
    db = parsed.path.lstrip("/")
    if db:
        params["dbname"] = db
    return params


def _ogr_pg_dsn(dsn: str) -> tuple[str, dict[str, str]]:
    """Build ogr2ogr PG connection string from DATABASE_URL.
    
    Returns (pg_dsn_without_password, env_dict_with_credentials) so the
    password is passed via environment rather than subprocess argv.
    """
    p = _parse_pg_dsn(dsn)
    password = p.pop("password", None)
    parts = [f"{k}={v}" for k, v in p.items()]
    env = {}
    if password:
        env["PGPASSWORD"] = password
    return "PG:" + " ".join(parts), env


def get_top_states(conn, limit: int = 10) -> list[tuple[str, str]]:
    """Return (state_fips, state_abbr) for top states by listing count.
    
    Maps 2-letter state abbreviations to numeric FIPS codes for NFHL downloads.
    """
    STATE_ABBR_TO_FIPS = {
        'AL':'01','AK':'02','AZ':'04','AR':'05','CA':'06','CO':'08','CT':'09',
        'DE':'10','DC':'11','FL':'12','GA':'13','HI':'15','ID':'16','IL':'17',
        'IN':'18','IA':'19','KS':'20','KY':'21','LA':'22','ME':'23','MD':'24',
        'MA':'25','MI':'26','MN':'27','MS':'28','MO':'29','MT':'30','NE':'31',
        'NV':'32','NH':'33','NJ':'34','NM':'35','NY':'36','NC':'37','ND':'38',
        'OH':'39','OK':'40','OR':'41','PA':'42','RI':'44','SC':'45','SD':'46',
        'TN':'47','TX':'48','UT':'49','VT':'50','VA':'51','WA':'53','WV':'54',
        'WI':'55','WY':'56',
    }
    with conn.cursor() as cur:
        cur.execute("""
            SELECT UPPER(state) AS abbr, COUNT(*) AS cnt
            FROM listings
            WHERE state IS NOT NULL AND LENGTH(state) >= 2
            GROUP BY 1
            ORDER BY 2 DESC
            LIMIT %s
        """, (limit,))
        results = []
        for row in cur.fetchall():
            abbr = row[0]
            fips = STATE_ABBR_TO_FIPS.get(abbr)
            if fips:
                results.append((fips, abbr))
        return results


def _download_nfhl(state_fips: str, tmp_dir: str) -> str | None:
    """Download the NFHL zip for a state and return the extracted GDB path.

    NOTE (2026-07-11): FEMA's bulk state endpoint
    (https://hazards.fema.gov/nfhlv2/output/State/NFHL_<FIPS>_Current.zip …)
    now 404s, and the Map Service Center direct-download
    (https://msc.fema.gov/portal/downloadProduct?productID=NFHL_<FIPS>C) returns
    a portal HTML login page rather than the file — automated bulk fetch is
    currently BLOCKED on FEMA access control. To unblock, either (a) script the
    MSC session (capture JSESSIONID/cookie from the portal, then re-request), or
    (b) page the public NFHL ArcGIS REST service
    (https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer) in
    1000-feature chunks, or (c) source the per-state GDBs another way. After a
    working source exists, this function's URL list is the only thing to update.
    """
    # FEMA filenames vary — try common patterns
    patterns = [
        f"NFHL_{state_fips}_*",
        f"NFHL_{state_fips}_*.zip",
    ]
    base_url = "https://hazards.fema.gov/nfhlv2/output/State"

    # Try likely direct download URLs
    urls = [
        f"{base_url}/NFHL_{state_fips}_Current/NFHL_{state_fips}_Current.zip",
        f"{base_url}/NFHL_{state_fips}_2024/NFHL_{state_fips}_2024.zip",
        f"{base_url}/NFHL_{state_fips}_2023/NFHL_{state_fips}_2023.zip",
        f"{base_url}/NFHL_{state_fips}_2025/NFHL_{state_fips}_2025.zip",
    ]

    zip_path = os.path.join(tmp_dir, f"nfhl_{state_fips}.zip")

    for url in urls:
        try:
            print(f"  trying {url}", file=sys.stderr)
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=600) as resp:
                data = resp.read()
            if len(data) < 1000:
                print(f"    too small ({len(data)} bytes), skipping", file=sys.stderr)
                continue
            with open(zip_path, "wb") as f:
                f.write(data)
            print(f"  downloaded {len(data)} bytes", file=sys.stderr)
            break
        except Exception as exc:
            print(f"    failed: {exc}", file=sys.stderr)
            continue
    else:
        print(f"  ERROR: could not download NFHL for state {state_fips}", file=sys.stderr)
        return None

    # Extract and find GDB
    print(f"  extracting zip ({os.path.getsize(zip_path)} bytes)", file=sys.stderr)
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(tmp_dir)

    # Look for .gdb directory
    for root, dirs, files in os.walk(tmp_dir):
        if root.endswith(".gdb") and "S_FLD_HAZ_AR" in _gdb_layers(root):
            return root

    # Also try .gdb.zip nested
    for gdb_zip in globmod.glob(os.path.join(tmp_dir, "**", "*.gdb.zip"), recursive=True):
        extract_dir = os.path.join(tmp_dir, "gdb_extracted")
        os.makedirs(extract_dir, exist_ok=True)
        with zipfile.ZipFile(gdb_zip) as zf:
            zf.extractall(extract_dir)
        for root, dirs, files in os.walk(extract_dir):
            if root.endswith(".gdb") and "S_FLD_HAZ_AR" in _gdb_layers(root):
                return root

    print(f"  ERROR: no GDB with S_FLD_HAZ_AR found for state {state_fips}", file=sys.stderr)
    return None


def _gdb_layers(gdb_path: str) -> list[str]:
    """List layer names in a GDB."""
    try:
        result = subprocess.run(
            ["ogrinfo", "-al", "-so", gdb_path],
            capture_output=True, text=True, timeout=30,
        )
        layers = []
        for line in result.stdout.splitlines():
            if line.startswith("Layer name:"):
                layers.append(line.split(":", 1)[1].strip())
        return layers
    except Exception:
        return []


def _load_state(state_fips: str, state_abbr: str, pg_dsn: str) -> None:
    """Download and load flood zones for a single state."""
    tmp_dir = tempfile.mkdtemp(prefix=f"nfhl_{state_fips}_")
    try:
        _check_disk()
        gdb_path = _download_nfhl(state_fips, tmp_dir)
        if gdb_path is None:
            return

        staging_table = "flood_zones_staging"
        ogr_dsn, ogr_env = _ogr_pg_dsn(pg_dsn)

        # Drop any leftover staging table
        _drop_staging(pg_dsn, staging_table)

        # Run ogr2ogr to load into staging
        cmd = [
            "ogr2ogr", "-f", "PostgreSQL",
            ogr_dsn,
            "-nln", staging_table,
            "-t_srs", "EPSG:4326",
            "-overwrite",
            gdb_path,
            "S_FLD_HAZ_AR",
        ]
        print(f"  running ogr2ogr for {state_abbr} ({state_fips})", file=sys.stderr)
        import os as _os
        run_env = {**_os.environ, **ogr_env}
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=3600, env=run_env)
        if result.returncode != 0:
            print(f"  ogr2ogr failed: {result.stderr}", file=sys.stderr)
            _drop_staging(pg_dsn, staging_table)
            return

        # Insert SFHA polygons into flood_zones from staging
        import psycopg2

        conn = psycopg2.connect(pg_dsn)
        try:
            with conn.cursor() as cur:
                # Check what columns exist in staging
                cur.execute("""
                    SELECT column_name FROM information_schema.columns
                    WHERE table_name = %s
                    ORDER BY ordinal_position
                """, (staging_table,))
                cols = {row[0] for row in cur.fetchall()}
                print(f"  staging columns: {sorted(cols)}", file=sys.stderr)

                # Determine column names — ogr2ogr may lowercase or title-case
                sfha_col = None
                for candidate in ["sfha_tf", "SFHA_TF", "Sfha_Tf"]:
                    if candidate in cols:
                        sfha_col = candidate
                        break
                if sfha_col is None:
                    # Case-insensitive lookup
                    for c in cols:
                        if c.lower() == "sfha_tf":
                            sfha_col = c
                            break

                fld_col = None
                for candidate in ["fld_zone", "FLD_ZONE", "Fld_Zone"]:
                    if candidate in cols:
                        fld_col = candidate
                        break
                if fld_col is None:
                    for c in cols:
                        if c.lower() == "fld_zone":
                            fld_col = c
                            break

                if sfha_col is None or fld_col is None:
                    print(f"  ERROR: missing required columns in staging: {sorted(cols)}", file=sys.stderr)
                    _drop_staging(pg_dsn, staging_table)
                    return

                # Also look for STATE_FIPS or STATE
                state_col = None
                for candidate in ["state_fips", "STATE_FIPS", "STATE", "State_Fips"]:
                    if candidate in cols:
                        state_col = candidate
                        break
                if state_col is None:
                    for c in cols:
                        if c.lower() in ("state_fips", "state"):
                            state_col = c
                            break

                # The geom column from ogr2ogr may be named differently
                geom_col = None
                for candidate in ["wkb_geometry", "WKB_GEOMETRY", "geom"]:
                    if candidate in cols:
                        geom_col = candidate
                        break
                if geom_col is None:
                    for c in cols:
                        if c.lower().startswith("wkb_geometry") or c.lower() == "geom":
                            geom_col = c
                            break

                if geom_col is None:
                    print(f"  ERROR: no geometry column found in staging", file=sys.stderr)
                    _drop_staging(pg_dsn, staging_table)
                    return

                from psycopg2 import sql as pg_sql

                # Build the INSERT using proper identifier quoting
                insert_query = pg_sql.SQL("""
                    INSERT INTO flood_zones (state_fips, fld_zone, sfha, geom)
                    SELECT
                        %s::text,
                        {fld}::text,
                        ({sfha} = 'T'),
                        ST_Multi(ST_Transform({geom}, 4326))
                    FROM {staging}
                    WHERE {sfha} = 'T'
                       OR {fld} IN ('AE', 'VE', 'A', 'AO', 'AH')
                """).format(
                    fld=pg_sql.Identifier(fld_col),
                    sfha=pg_sql.Identifier(sfha_col),
                    geom=pg_sql.Identifier(geom_col),
                    staging=pg_sql.Identifier(staging_table),
                )

                cur.execute(insert_query, (state_fips,))
                inserted = cur.rowcount
            conn.commit()
        finally:
            conn.close()

        # Drop staging table
        _drop_staging(pg_dsn, staging_table)

        print(json.dumps({"done": True, "state": state_fips, "abbr": state_abbr, "rows": inserted}))

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def _drop_staging(pg_dsn: str, table: str) -> None:
    """Drop staging table if it exists."""
    import psycopg2
    from psycopg2 import sql as pg_sql

    try:
        conn = psycopg2.connect(pg_dsn)
        with conn.cursor() as cur:
            cur.execute(pg_sql.SQL("DROP TABLE IF EXISTS {}").format(pg_sql.Identifier(table)))
        conn.commit()
        conn.close()
    except Exception:
        pass


def main() -> None:
    _check_ogr2ogr()

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("ERROR: DATABASE_URL env var required", file=sys.stderr)
        sys.exit(1)

    import psycopg2

    conn = psycopg2.connect(dsn)
    try:
        # Check for --state-fips flag
        single_state = None
        if "--state-fips" in sys.argv:
            idx = sys.argv.index("--state-fips")
            if idx + 1 < len(sys.argv):
                single_state = sys.argv[idx + 1]

        if single_state:
            states = [(single_state, single_state.upper())]
        else:
            states = get_top_states(conn)
            print(f"Top {len(states)} states: {[s[1] for s in states]}", file=sys.stderr)
    finally:
        conn.close()

    for state_fips, state_abbr in states:
        print(f"\nProcessing {state_abbr} (FIPS {state_fips})...", file=sys.stderr)
        _load_state(state_fips, state_abbr, dsn)

    print(json.dumps({"done": True, "states_loaded": len(states)}))


if __name__ == "__main__":
    main()
