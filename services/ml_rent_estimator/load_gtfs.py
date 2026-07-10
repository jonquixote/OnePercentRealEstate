"""Load transit stops from GTFS feeds for the ~15 largest US metro areas.

Each GTFS zip contains stops.txt, and optionally stop_times.txt, trips.txt, routes.txt.
If the join files exist and are small enough (<200 MB total), we join to get route_types
per stop (e.g. {0,3} for rail+bus). Otherwise, stops are stored with empty route_types.

Usage:
  DATABASE_URL=... python load_gtfs.py
  DATABASE_URL=... python load_gtfs.py --feed la-metro
"""
from __future__ import annotations

import csv
import io
import json
import os
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

FEEDS = {
    "la-metro-bus": "https://gitlab.com/LACMTA/gtfs_bus/raw/master/gtfs_bus.zip",
    "la-metro-rail": "https://gitlab.com/LACMTA/gtfs_rail/raw/master/gtfs_rail.zip",
    "nyc-mta-subway": "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip",
    "nyc-mta-bus": "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_busco.zip",
    "chicago-cta": "http://www.transitchicago.com/downloads/sch_data/google_transit.zip",
    "boston-mbta": "https://cdn.mbta.com/MBTA_GTFS.zip",
    "septa": "https://www3.septa.org/developer/gtfs_public.zip",
    "metro-transit-mn": "https://svc.metrotransit.org/mtgtfs/gtfs.zip",
    "trimet": "https://developer.trimet.org/schedule/gtfs.zip",
    "king-county-metro": "http://metro.kingcounty.gov/GTFS/google_transit.zip",
    "marta": "https://itsmarta.com/google_transit_feed/google_transit.zip",
    "dart": "http://www.dart.org/transitdata/latest/google_transit.zip",
    "houston-metro": "https://metro.resourcespace.com/pages/download.php?ref=4835&ext=zip",
    "denver-rtd": "https://www.rtd-denver.com/files/gtfs/google_transit.zip",
    "miami-dade": "http://www.miamidade.gov/transit/googletransit/current/google_transit.zip",
}

MAX_JOIN_SIZE = 200 * 1024 * 1024  # 200 MB


def _download(url: str, dest: str) -> None:
    print(f"  downloading {url}", file=sys.stderr)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        with open(dest, "wb") as f:
            shutil.copyfileobj(resp, f)


def _read_csv_text(zf: zipfile.ZipFile, name: str) -> str:
    data = zf.read(name)
    return data.decode("utf-8-sig", errors="replace")


def _load_route_types(zf: zipfile.ZipFile) -> dict[str, list[int]]:
    """Join stop_times → trips → routes to get route_types per stop_id.

    Returns {stop_id: [route_type, ...]}.
    Returns empty dict if any required file is missing or total size is too large.
    """
    required = ["stop_times.txt", "trips.txt", "routes.txt"]
    for name in required:
        if name not in zf.namelist():
            return {}

    total_size = sum(zf.getinfo(n).file_size for n in required)
    if total_size > MAX_JOIN_SIZE:
        print(f"  join files too large ({total_size} bytes), skipping route_types", file=sys.stderr)
        return {}

    try:
        routes_text = _read_csv_text(zf, "routes.txt")
        routes_reader = csv.DictReader(io.StringIO(routes_text))
        route_type_map: dict[str, int] = {}
        for row in routes_reader:
            rid = row.get("route_id", "").strip()
            rtype = row.get("route_type", "").strip()
            if rid and rtype:
                try:
                    route_type_map[rid] = int(rtype)
                except ValueError:
                    pass

        trips_text = _read_csv_text(zf, "trips.txt")
        trips_reader = csv.DictReader(io.StringIO(trips_text))
        trip_route: dict[str, str] = {}
        for row in trips_reader:
            tid = row.get("trip_id", "").strip()
            rid = row.get("route_id", "").strip()
            if tid and rid:
                trip_route[tid] = rid

        stop_times_text = _read_csv_text(zf, "stop_times.txt")
        st_reader = csv.DictReader(io.StringIO(stop_times_text))
        stop_routes: dict[str, set[int]] = {}
        for row in st_reader:
            sid = row.get("stop_id", "").strip()
            tid = row.get("trip_id", "").strip()
            if sid and tid:
                rid = trip_route.get(tid)
                if rid:
                    rt = route_type_map.get(rid)
                    if rt is not None:
                        stop_routes.setdefault(sid, set()).add(rt)

        return {k: sorted(v) for k, v in stop_routes.items()}
    except Exception as exc:
        print(f"  route_type join failed: {exc}", file=sys.stderr)
        return {}


def _upsert_stops(feed: str, stops: list[tuple[str, float, float, list[int]]], conn) -> int:
    import psycopg2.extras as extras

    with conn.cursor() as cur:
        extras.execute_values(
            cur,
            """INSERT INTO transit_stops (feed, stop_id, geom, route_types)
               VALUES %s
               ON CONFLICT (feed, stop_id)
               DO UPDATE SET geom = EXCLUDED.geom, route_types = EXCLUDED.route_types""",
            [
                (feed, sid, f"SRID=4326;POINT({lon} {lat})", route_types)
                for sid, lat, lon, route_types in stops
            ],
            page_size=5000,
        )
    conn.commit()
    return len(stops)


def load_feed(feed: str, url: str, conn) -> dict:
    tmp_dir = tempfile.mkdtemp(prefix=f"gtfs_{feed}_")
    try:
        zip_path = os.path.join(tmp_dir, f"{feed}.zip")
        _download(url, zip_path)

        with zipfile.ZipFile(zip_path, "r") as zf:
            # Handle nested zips (e.g., SEPTA: google_bus.zip, google_rail.zip)
            nested_zips = [n for n in zf.namelist() if n.lower().endswith(".zip")]
            if nested_zips and "stops.txt" not in zf.namelist():
                # Extract and parse the first nested zip
                nested_name = nested_zips[0]
                nested_data = zf.read(nested_name)
                nested_path = os.path.join(tmp_dir, nested_name)
                with open(nested_path, "wb") as f:
                    f.write(nested_data)
                with zipfile.ZipFile(nested_path, "r") as nzf:
                    route_types_map = _load_route_types(nzf)
                    if "stops.txt" not in nzf.namelist():
                        return {"done": False, "feed": feed, "error": "stops.txt not found in nested zip"}
                    stops_text = _read_csv_text(nzf, "stops.txt")
            # Handle subdirectories (e.g., Miami-Dade: "BUS 27APR26/stops.txt")
            elif "stops.txt" not in zf.namelist():
                stops_candidates = [n for n in zf.namelist() if n.endswith("/stops.txt")]
                if not stops_candidates:
                    return {"done": False, "feed": feed, "error": "stops.txt not found"}
                stops_name = stops_candidates[0]
                stops_text = _read_csv_text(zf, stops_name)
                # Also try to load route_types from same directory
                dir_prefix = stops_name.rsplit("/", 1)[0] + "/"
                route_types_files = {
                    "routes.txt": dir_prefix + "routes.txt",
                    "trips.txt": dir_prefix + "trips.txt",
                    "stop_times.txt": dir_prefix + "stop_times.txt",
                }
                # Build a virtual zipfile-like object for _load_route_types
                # Simpler: just parse them directly
                route_types_map = {}
                try:
                    routes_text = _read_csv_text(zf, route_types_files["routes.txt"])
                    routes_reader = csv.DictReader(io.StringIO(routes_text))
                    route_type_map_local = {}
                    for row in routes_reader:
                        rid = row.get("route_id", "").strip()
                        rtype = row.get("route_type", "").strip()
                        if rid and rtype:
                            try:
                                route_type_map_local[rid] = int(rtype)
                            except ValueError:
                                pass
                    trips_text = _read_csv_text(zf, route_types_files["trips.txt"])
                    trips_reader = csv.DictReader(io.StringIO(trips_text))
                    trip_route = {}
                    for row in trips_reader:
                        tid = row.get("trip_id", "").strip()
                        rid = row.get("route_id", "").strip()
                        if tid and rid:
                            trip_route[tid] = rid
                    stop_times_text = _read_csv_text(zf, route_types_files["stop_times.txt"])
                    st_reader = csv.DictReader(io.StringIO(stop_times_text))
                    stop_routes = {}
                    for row in st_reader:
                        sid = row.get("stop_id", "").strip()
                        tid = row.get("trip_id", "").strip()
                        if sid and tid:
                            rid = trip_route.get(tid)
                            if rid:
                                rt = route_type_map_local.get(rid)
                                if rt is not None:
                                    stop_routes.setdefault(sid, set()).add(rt)
                    route_types_map = {k: sorted(v) for k, v in stop_routes.items()}
                except Exception:
                    pass
            else:
                route_types_map = _load_route_types(zf)
                stops_text = _read_csv_text(zf, "stops.txt")

        reader = csv.DictReader(io.StringIO(stops_text))
        stops: list[tuple[str, float, float, list[int]]] = []
        for row in reader:
            sid = row.get("stop_id", "").strip()
            lat_s = row.get("stop_lat", "").strip()
            lon_s = row.get("stop_lon", "").strip()
            if not sid or not lat_s or not lon_s:
                continue
            try:
                lat = float(lat_s)
                lon = float(lon_s)
            except ValueError:
                continue
            rt = route_types_map.get(sid, [])
            stops.append((sid, lat, lon, rt))

        n = _upsert_stops(feed, stops, conn)
        return {"done": True, "feed": feed, "stops": n}
    except Exception as exc:
        return {"done": False, "feed": feed, "error": str(exc)}
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def main() -> None:
    import psycopg2

    target_feed = None
    if "--feed" in sys.argv:
        i = sys.argv.index("--feed")
        target_feed = sys.argv[i + 1] if i + 1 < len(sys.argv) else None
        if target_feed is None:
            raise SystemExit("ERROR: --feed requires a feed name")

    feeds = FEEDS if target_feed is None else {target_feed: FEEDS[target_feed]}

    dsn = os.environ["DATABASE_URL"]
    conn = psycopg2.connect(dsn)
    try:
        for feed, url in feeds.items():
            result = load_feed(feed, url, conn)
            print(json.dumps(result))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
