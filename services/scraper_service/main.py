from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, Union, List
from homeharvest import scrape_property
import pandas as pd
import psycopg2
from psycopg2.extras import Json
import os
import datetime as dt
import urllib.parse
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from time import sleep
from enrichment import extract_enrichment, _num, _date

app = FastAPI()

# Database connection
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    DB_USER = os.getenv("DB_USER", "postgres")
    DB_PASS = os.getenv("DB_PASS", "root_password_change_me_please")
    DB_HOST = os.getenv("DB_HOST", "infrastructure-postgres-1")
    DB_PORT = os.getenv("DB_PORT", "5432")
    DB_NAME = os.getenv("DB_NAME", "postgres")
    DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASS}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

DEFAULT_USER_ID = os.getenv("DEFAULT_USER_ID")

CENSUS_BENCHMARK = 'Public_AR_Current'

def get_db_connection():
    try:
        return psycopg2.connect(DATABASE_URL)
    except Exception as e:
        print(f"DB Connect Error: {e}")
        return None

def geocode_address_census(address):
    if not address:
        return None
    try:
        encoded = urllib.parse.quote(address)
        url = f"https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address={encoded}&benchmark={CENSUS_BENCHMARK}&format=json"
        resp = requests.get(url, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            matches = data.get('result', {}).get('addressMatches', [])
            if matches:
                c = matches[0]['coordinates']
                return (c['y'], c['x'])
    except Exception as e:
        print(f"Census geocode error: {e}")
    return None

def geocode_address_nominatim(address):
    if not address:
        return None
    try:
        encoded = urllib.parse.quote(address)
        url = f"https://nominatim.openstreetmap.org/search?q={encoded}&format=json&limit=1"
        resp = requests.get(url, headers={'User-Agent': 'OnePercentRealEstate/1.0'}, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            if data:
                return (float(data[0]['lat']), float(data[0]['lon']))
    except Exception as e:
        print(f"Nominatim geocode error: {e}")
    return None

def batch_geocode(address_list):
    """Batch geocode: Census (parallel) then Nominatim fallback (sequential, 1 req/sec).
    
    address_list: list of (index, address_string) tuples
    Returns: dict index -> (lat, lon)
    """
    results = {}
    fallback_list = []

    with ThreadPoolExecutor(max_workers=10) as pool:
        fut_map = {pool.submit(geocode_address_census, addr): idx for idx, addr in address_list}
        for fut in as_completed(fut_map):
            idx = fut_map[fut]
            coords = fut.result()
            if coords:
                results[idx] = coords
            else:
                fallback_list.append((idx, dict(address_list)[idx]))

    for idx, addr in fallback_list:
        coords = geocode_address_nominatim(addr)
        if coords:
            results[idx] = coords
        sleep(1.1)

    return results

def get_property_type(row):
    return row.get('style') or row.get('property_type') or row.get('home_type') or row.get('prop_type')

# Statuses homeharvest returns for a for-sale-side row (incl. the pending/
# contingent variants surfaced by the or_filters). These are correctly stored
# in the `listings` table.
_FOR_SALE_STATUSES = {
    'for_sale', 'ready_to_build', 'new_community', 'pending', 'contingent',
    'active', 'off_market', 'other', 'coming_soon',
}


def route_row_type(row_status, is_combined, req_listing_type):
    """Decide which table a scraped row belongs to.

    For a combined (list) query, homeharvest tags each row with its own
    `status`; we route on that. For a single-type request we trust the
    request so the sold/pending/foreclosure passes behave exactly as before.

    Returns one of: 'for_rent' | 'sold' | 'for_sale'. Unknown/empty statuses
    fall back to 'for_sale' (the listings table) but the caller should log
    them so an upstream vocabulary change is visible rather than silent.
    """
    if not is_combined:
        return req_listing_type
    s = str(row_status or '').strip().lower()
    if 'rent' in s:            # for_rent, rent, etc.
        return 'for_rent'
    if s == 'sold':
        return 'sold'
    return 'for_sale'

class ScrapeRequest(BaseModel):
    location: str
    # Accepts a single listing type ("for_sale") or a list (["for_sale", "for_rent"]).
    # A list issues ONE combined homeharvest query (status: [...]) and the results
    # are demuxed row-by-row into the correct table via each row's `status` field.
    listing_type: Union[str, List[str]] = "for_sale"
    past_days: int = 30
    radius: Optional[float] = None
    mls_only: bool = False
    foreclosure: bool = False
    min_price: Optional[float] = None
    max_price: Optional[float] = None
    beds_min: Optional[int] = None
    baths_min: Optional[float] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    source: str = "homeharvest"
    # Parallel pagination fires all result pages concurrently (a ThreadPoolExecutor
    # of ~32). That burst of simultaneous requests from one IP is a primary
    # Realtor.com bot-detection trigger, so it defaults OFF here: pages are
    # fetched sequentially, matching the gentle cadence that ran unblocked for
    # months. Callers can override per-request if a large windowed pull needs it.
    parallel: bool = False
    # Per-property detail fetches. NOTE: this is a no-op in the pinned homeharvest
    # 0.8.18 (the library hard-disables it: `self.extra_property_data = False`),
    # kept only so a future upgrade doesn't silently re-enable a heavy per-page
    # detail query. Default OFF to keep request volume minimal.
    extra_property_data: bool = False

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.post("/scrape")
def scrape_listings(req: ScrapeRequest):
    try:
        # Dispatch to padmapper adapter if source is padmapper
        if req.source == "padmapper":
            return _scrape_padmapper(req)
        
        print(f"Scraping {req.location} ({req.listing_type})...")
        
        scrape_kwargs = dict(
            location=req.location,
            listing_type=req.listing_type,
            past_days=req.past_days,
            radius=req.radius,
            mls_only=req.mls_only,
            foreclosure=req.foreclosure,
            extra_property_data=req.extra_property_data,
            parallel=req.parallel,
        )
        if req.date_from:
            scrape_kwargs["date_from"] = req.date_from
        if req.date_to:
            scrape_kwargs["date_to"] = req.date_to
        df = scrape_property(**scrape_kwargs)
        
        # A list listing_type means one combined query returned mixed statuses;
        # route each row by its own `status`. A single string keeps the legacy
        # request-level routing so the sold/pending/foreclosure passes are
        # unchanged.
        is_combined = isinstance(req.listing_type, list)
        print(f"Combined demux: {is_combined}")
        
        if df is None or (hasattr(df, "empty") and df.empty):
            print(f"No results for {req.location}")
            return {"count": 0, "inserted": 0, "updated": 0, "skipped": 0}

        print(f"df shape: {df.shape}")

        df = df.loc[:, ~df.columns.duplicated()]

        if 'full_baths' in df.columns and 'half_baths' in df.columns:
            df['baths'] = df['full_baths'].fillna(0) + df['half_baths'].fillna(0) * 0.5
        elif 'full_baths' in df.columns:
            df['baths'] = df['full_baths'].fillna(0)
        else:
            df['baths'] = 0

        if req.min_price is not None:
            df = df[df['list_price'] >= req.min_price]
        if req.max_price is not None:
            df = df[df['list_price'] <= req.max_price]
        if req.beds_min is not None:
            df = df[df['beds'] >= req.beds_min]

        records = df.to_dict(orient='records')
        
        clean_records = []
        for rec in records:
            clean_rec = {}
            for k, v in rec.items():
                if isinstance(v, (list, tuple, dict, set)):
                    clean_rec[k] = v
                elif pd.isna(v):
                    clean_rec[k] = None
                else:
                    clean_rec[k] = v
            clean_records.append(clean_rec)

        if not clean_records:
            return {"count": 0, "inserted": 0, "updated": 0, "skipped": 0}

        # Phase 1: Collect all addresses for batch geocoding
        address_list = []
        for i, row in enumerate(clean_records):
            zip_raw = row.get('zip_code')
            zip_code = str(zip_raw).split('.')[0].zfill(5) if zip_raw else ""
            address = f"{row.get('street', '')}, {row.get('city', '')}, {row.get('state', '')} {zip_code}".strip(", ")
            if address:
                address_list.append((i, address))

        # Phase 2: Batch geocode (Census parallel + Nominatim fallback)
        print(f"Batch geocoding {len(address_list)} addresses...")
        coords_map = batch_geocode(address_list)
        print(f"Geocoded {len(coords_map)}/{len(address_list)} addresses")

        # Phase 3: Process and insert
        conn = get_db_connection()
        if not conn:
            raise HTTPException(status_code=500, detail="Database connection failed")

        cursor = conn.cursor()
        inserted = 0
        updated = 0
        skipped = 0

        try:
            for i, row in enumerate(clean_records):
                # Per-row routing. For a combined call we trust each row's own
                # `status`; otherwise the request-level listing_type drives it.
                row_status = str(row.get('status') or '').strip().lower()
                if is_combined and row_status and row_status not in _FOR_SALE_STATUSES and 'rent' not in row_status and row_status != 'sold':
                    print(f"WARN: unexpected combined-row status '{row_status}' -> routing to listings (for_sale)")
                row_type = route_row_type(row_status, is_combined, req.listing_type)
                is_rental = row_type == 'for_rent'
                is_sold = row_type == 'sold'

                zip_raw = row.get('zip_code')
                zip_code = str(zip_raw).split('.')[0].zfill(5) if zip_raw else ""
                address = f"{row.get('street', '')}, {row.get('city', '')}, {row.get('state', '')} {zip_code}".strip(", ")
                
                if not address or address == "":
                    skipped += 1
                    continue

                price = row.get('list_price') or 0
                bedrooms = row.get('beds')
                bathrooms = row.get('baths')
                sqft = row.get('sqft')
                year_built = row.get('year_built')

                raw_data = dict(row)
                for k, v in raw_data.items():
                    if isinstance(v, (list, tuple, dict, set)):
                        continue
                    if pd.isna(v) if hasattr(pd, 'isna') else v != v:
                        raw_data[k] = None
                    elif hasattr(v, 'isoformat'):
                        raw_data[k] = v.isoformat()

                # Use geocoded coordinates, fall back to source coords
                coords = coords_map.get(i)
                if coords:
                    raw_data["lat"], raw_data["lon"] = coords
                else:
                    raw_data["lat"] = row.get('latitude')
                    raw_data["lon"] = row.get('longitude')

                # Extract enrichment fields for insertion
                enr = extract_enrichment(raw_data)

                images = []
                if row.get('primary_photo'):
                    images.append(row['primary_photo'])
                if row.get('alt_photos'):
                    alts = str(row['alt_photos'])
                    if alts and alts.lower() != 'nan':
                        images.extend([u.strip() for u in alts.split(',') if u.strip()])

                if is_rental:
                    cursor.execute("SELECT id, price FROM rental_listings WHERE address = %s AND listing_date = CURRENT_DATE", (address,))
                    existing = cursor.fetchone()
                    
                    if existing:
                        skipped += 1
                        continue
                    else:
                        cursor.execute("""
                            INSERT INTO rental_listings (
                                address, city, state, zip_code, price, bedrooms, bathrooms,
                                sqft, property_type, latitude, longitude, source, raw_data
                            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """, (
                            address, row.get('city'), row.get('state'), zip_code, price,
                            bedrooms, bathrooms, sqft, get_property_type(row),
                            raw_data.get("lat"), raw_data.get("lon"), 
                            'homeharvest', Json(raw_data)
                        ))
                        inserted += 1
                elif is_sold:
                    sold_price = _num(row.get('sold_price'))
                    sold_date = _date(row.get('last_sold_date'))
                    list_price = _num(row.get('list_price'))
                    # Source feeds placeholder/typo dates: a 2099-01-01
                    # "pending" sentinel and outright future typos. A sale
                    # cannot be in the future — reject so they never pollute
                    # comps/ARV/market stats.
                    if sold_date and sold_date > dt.date.today():
                        sold_date = None
                    if not sold_price or sold_price <= 0 or not sold_date:
                        skipped += 1
                        continue
                    cursor.execute("""
                        INSERT INTO sold_listings (
                            address, city, state, zip_code,
                            sold_price, sold_date, list_price,
                            bedrooms, bathrooms, sqft, year_built, lot_sqft,
                            property_type, latitude, longitude, source, raw_data
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (address, sold_date) DO NOTHING
                    """, (
                        address, row.get('city'), row.get('state'), zip_code,
                        sold_price, sold_date, list_price,
                        _num(row.get('beds')), _num(row.get('baths')),
                        int(_num(row.get('sqft'))) if _num(row.get('sqft')) else None,
                        int(_num(row.get('year_built'))) if _num(row.get('year_built')) else None,
                        _num(row.get('lot_sqft')),
                        get_property_type(row),
                        raw_data.get("lat"), raw_data.get("lon"),
                        'homeharvest', Json(raw_data)
                    ))
                    if cursor.rowcount > 0:
                        inserted += 1
                    else:
                        skipped += 1
                # NOTE: census_tract is assigned via nightly backfill
                # (backfill_census_tract.sql) instead of at-scrape ST_Contains,
                # which was measured as too slow per spec §B3 fallback plan.
                else:
                    cursor.execute("""
                        INSERT INTO listings (
                            address, city, state, zip_code, price, bedrooms, bathrooms,
                            sqft, year_built, property_type, listing_type, images, raw_data,
                            latitude, longitude, user_id,
                            sale_type, sale_type_source, sale_type_signal, sale_type_confidence,
                            address_norm, address_hash,
                            county, fips_code, neighborhoods, last_sold_price, last_sold_date,
                            assessed_value, estimated_value, description, style, new_construction,
                            list_date, price_per_sqft, hoa_fee, tax_annual_amount, property_url,
                            parking_garage, lot_sqft,
                            stories, nearby_schools, agent_info, tax_history
                        )
                        SELECT
                            %s, %s, %s, %s, %s, %s, %s,
                            %s, %s, %s, %s, %s, %s,
                            %s, %s, %s,
                            CASE WHEN %s::bool AND c.sale_type = 'standard' THEN 'foreclosure' ELSE c.sale_type END,
                            CASE WHEN %s::bool AND c.sale_type = 'standard' THEN 'homeharvest_flag' ELSE c.sale_type_source END,
                            CASE WHEN %s::bool AND c.sale_type = 'standard' THEN 'homeharvest foreclosure filter' ELSE c.sale_type_signal END,
                            CASE WHEN %s::bool AND c.sale_type = 'standard' THEN 0.95 ELSE c.sale_type_confidence END,
                            n.address_norm,
                            md5(coalesce(n.address_norm, '') || '|' || coalesce(lower(%s), '') || '|' || coalesce(lower(%s), '')),
                            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                            %s, %s, %s, %s
                        FROM classify_sale_type(%s::jsonb, %s) c,
                             LATERAL (
                                 SELECT NULLIF(regexp_replace(regexp_replace(lower(trim(%s)), '[.,#]', '', 'g'), '\\s+', ' ', 'g'), '') AS address_norm
                             ) n
                        ON CONFLICT (address, listing_type, sale_type)
                        DO UPDATE SET
                            price = EXCLUDED.price,
                            bedrooms = COALESCE(EXCLUDED.bedrooms, listings.bedrooms),
                            bathrooms = COALESCE(EXCLUDED.bathrooms, listings.bathrooms),
                            sqft = COALESCE(EXCLUDED.sqft, listings.sqft),
                            year_built = COALESCE(EXCLUDED.year_built, listings.year_built),
                            property_type = COALESCE(EXCLUDED.property_type, listings.property_type),
                            images = EXCLUDED.images,
                            raw_data = EXCLUDED.raw_data,
                            latitude = COALESCE(EXCLUDED.latitude, listings.latitude),
                            longitude = COALESCE(EXCLUDED.longitude, listings.longitude),
                            sale_type_source = COALESCE(EXCLUDED.sale_type_source, listings.sale_type_source),
                            sale_type_signal = COALESCE(EXCLUDED.sale_type_signal, listings.sale_type_signal),
                            sale_type_confidence = COALESCE(EXCLUDED.sale_type_confidence, listings.sale_type_confidence),
                            address_norm = COALESCE(EXCLUDED.address_norm, listings.address_norm),
                            address_hash = COALESCE(EXCLUDED.address_hash, listings.address_hash),
                            county = COALESCE(EXCLUDED.county, listings.county),
                            fips_code = COALESCE(EXCLUDED.fips_code, listings.fips_code),
                            neighborhoods = COALESCE(EXCLUDED.neighborhoods, listings.neighborhoods),
                            last_sold_price = COALESCE(EXCLUDED.last_sold_price, listings.last_sold_price),
                            last_sold_date = COALESCE(EXCLUDED.last_sold_date, listings.last_sold_date),
                            assessed_value = COALESCE(EXCLUDED.assessed_value, listings.assessed_value),
                            estimated_value = COALESCE(EXCLUDED.estimated_value, listings.estimated_value),
                            description = COALESCE(EXCLUDED.description, listings.description),
                            style = COALESCE(EXCLUDED.style, listings.style),
                            new_construction = COALESCE(EXCLUDED.new_construction, listings.new_construction),
                            list_date = COALESCE(EXCLUDED.list_date, listings.list_date),
                            price_per_sqft = COALESCE(EXCLUDED.price_per_sqft, listings.price_per_sqft),
                            hoa_fee = COALESCE(EXCLUDED.hoa_fee, listings.hoa_fee),
                            tax_annual_amount = COALESCE(EXCLUDED.tax_annual_amount, listings.tax_annual_amount),
                            property_url = COALESCE(EXCLUDED.property_url, listings.property_url),
                            parking_garage = COALESCE(EXCLUDED.parking_garage, listings.parking_garage),
                            lot_sqft = COALESCE(EXCLUDED.lot_sqft, listings.lot_sqft),
                            stories = COALESCE(EXCLUDED.stories, listings.stories),
                            nearby_schools = COALESCE(EXCLUDED.nearby_schools, listings.nearby_schools),
                            agent_info = COALESCE(EXCLUDED.agent_info, listings.agent_info),
                            tax_history = COALESCE(EXCLUDED.tax_history, listings.tax_history),
                            updated_at = NOW()
                        WHERE (EXCLUDED.price IS NOT NULL AND listings.price IS DISTINCT FROM EXCLUDED.price)
                           OR (EXCLUDED.bedrooms IS NOT NULL AND listings.bedrooms IS DISTINCT FROM EXCLUDED.bedrooms)
                           OR (EXCLUDED.bathrooms IS NOT NULL AND listings.bathrooms IS DISTINCT FROM EXCLUDED.bathrooms)
                           OR (EXCLUDED.sqft IS NOT NULL AND listings.sqft IS DISTINCT FROM EXCLUDED.sqft)
                           OR (EXCLUDED.year_built IS NOT NULL AND listings.year_built IS DISTINCT FROM EXCLUDED.year_built)
                           OR (EXCLUDED.property_type IS NOT NULL AND listings.property_type IS DISTINCT FROM EXCLUDED.property_type)
                           OR (EXCLUDED.sale_type_source IS NOT NULL AND listings.sale_type_source IS DISTINCT FROM EXCLUDED.sale_type_source)
                           OR (EXCLUDED.sale_type_signal IS NOT NULL AND listings.sale_type_signal IS DISTINCT FROM EXCLUDED.sale_type_signal)
                           OR (EXCLUDED.sale_type_confidence IS NOT NULL AND listings.sale_type_confidence IS DISTINCT FROM EXCLUDED.sale_type_confidence)
                           OR (EXCLUDED.latitude IS NOT NULL AND listings.latitude IS DISTINCT FROM EXCLUDED.latitude)
                           OR (EXCLUDED.longitude IS NOT NULL AND listings.longitude IS DISTINCT FROM EXCLUDED.longitude)
                           OR (EXCLUDED.county IS NOT NULL AND listings.county IS DISTINCT FROM EXCLUDED.county)
                           OR (EXCLUDED.fips_code IS NOT NULL AND listings.fips_code IS DISTINCT FROM EXCLUDED.fips_code)
                           OR (EXCLUDED.neighborhoods IS NOT NULL AND listings.neighborhoods IS DISTINCT FROM EXCLUDED.neighborhoods)
                           OR (EXCLUDED.last_sold_price IS NOT NULL AND listings.last_sold_price IS DISTINCT FROM EXCLUDED.last_sold_price)
                           OR (EXCLUDED.last_sold_date IS NOT NULL AND listings.last_sold_date IS DISTINCT FROM EXCLUDED.last_sold_date)
                           OR (EXCLUDED.assessed_value IS NOT NULL AND listings.assessed_value IS DISTINCT FROM EXCLUDED.assessed_value)
                           OR (EXCLUDED.estimated_value IS NOT NULL AND listings.estimated_value IS DISTINCT FROM EXCLUDED.estimated_value)
                           OR (EXCLUDED.description IS NOT NULL AND listings.description IS DISTINCT FROM EXCLUDED.description)
                           OR (EXCLUDED.style IS NOT NULL AND listings.style IS DISTINCT FROM EXCLUDED.style)
                           OR (EXCLUDED.new_construction IS NOT NULL AND listings.new_construction IS DISTINCT FROM EXCLUDED.new_construction)
                           OR (EXCLUDED.list_date IS NOT NULL AND listings.list_date IS DISTINCT FROM EXCLUDED.list_date)
                           OR (EXCLUDED.price_per_sqft IS NOT NULL AND listings.price_per_sqft IS DISTINCT FROM EXCLUDED.price_per_sqft)
                           OR (EXCLUDED.hoa_fee IS NOT NULL AND listings.hoa_fee IS DISTINCT FROM EXCLUDED.hoa_fee)
                           OR (EXCLUDED.tax_annual_amount IS NOT NULL AND listings.tax_annual_amount IS DISTINCT FROM EXCLUDED.tax_annual_amount)
                           OR (EXCLUDED.property_url IS NOT NULL AND listings.property_url IS DISTINCT FROM EXCLUDED.property_url)
                           OR (EXCLUDED.parking_garage IS NOT NULL AND listings.parking_garage IS DISTINCT FROM EXCLUDED.parking_garage)
                           OR (EXCLUDED.lot_sqft IS NOT NULL AND listings.lot_sqft IS DISTINCT FROM EXCLUDED.lot_sqft)
                           OR (EXCLUDED.stories IS NOT NULL AND listings.stories IS DISTINCT FROM EXCLUDED.stories)
                           OR (EXCLUDED.nearby_schools IS NOT NULL AND listings.nearby_schools IS DISTINCT FROM EXCLUDED.nearby_schools)
                           OR (EXCLUDED.agent_info IS NOT NULL AND listings.agent_info IS DISTINCT FROM EXCLUDED.agent_info)
                           OR (EXCLUDED.tax_history IS NOT NULL AND listings.tax_history IS DISTINCT FROM EXCLUDED.tax_history)
                        RETURNING id, (xmax = 0) as was_inserted
                    """, (
                        address, row.get('city'), row.get('state'), zip_code, price,
                        bedrooms, bathrooms, sqft, year_built, get_property_type(row),
                        row_type, Json(images), Json(raw_data), raw_data.get("lat"), raw_data.get("lon"),
                        DEFAULT_USER_ID,
                        req.foreclosure, req.foreclosure, req.foreclosure, req.foreclosure,
                        row.get('city'), row.get('state'),
                        enr["county"], enr["fips_code"], enr["neighborhoods"],
                        enr["last_sold_price"], enr["last_sold_date"], enr["assessed_value"],
                        enr["estimated_value"], enr["description"], enr["style"],
                        enr["new_construction"], enr["list_date"], enr["price_per_sqft"],
                        enr["hoa_fee"], enr["tax_annual_amount"], enr["property_url"],
                        enr["parking_garage"], enr["lot_sqft"],
                        enr["stories"], enr["nearby_schools"], enr["agent_info"], enr["tax_history"],
                        Json(raw_data), get_property_type(row),
                        address
                    ))
                    result = cursor.fetchone()
                    if result:
                        if result[1]:
                            inserted += 1
                        else:
                            updated += 1
                    else:
                        skipped += 1

                if (inserted + updated + skipped) % 50 == 0:
                    conn.commit()

            conn.commit()

        except Exception as e:
            conn.rollback()
            print(f"DB Error: {e}")
            raise HTTPException(status_code=500, detail=f"DB Error: {str(e)}")
        finally:
            cursor.close()
            conn.close()

        print(f"Completed {req.location}: {inserted} inserted, {updated} updated, {skipped} skipped")
        return {"count": len(clean_records), "inserted": inserted, "updated": updated, "skipped": skipped}

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error scraping {req.location}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# PadMapper adapter support
# ---------------------------------------------------------------------------

# Hardcoded ZIP to lat/lng + bbox offset for common areas (fallback when zcta_geometries doesn't exist)
_ZIP_COORDS: dict[str, tuple[float, float]] = {
    "10001": (40.7484, -73.9967),   # NYC
    "10002": (40.7157, -73.9863),
    "10003": (40.7317, -73.9893),
    "10011": (40.7418, -74.0002),
    "10013": (40.7201, -74.0049),
    "10014": (40.7340, -74.0054),
    "33602": (27.9506, -82.4572),   # Tampa
    "33603": (27.9659, -82.4710),
    "33605": (27.9484, -82.4367),
    "33606": (27.9377, -82.4979),
    "33607": (27.9528, -82.5253),
    "33609": (27.9429, -82.5283),
    "33610": (28.0027, -82.4370),
    "33611": (27.9151, -82.4684),
    "33613": (28.0444, -82.4392),
    "33614": (28.0367, -82.5056),
    "33615": (27.9983, -82.5482),
    "33616": (27.9390, -82.3915),
    "33617": (28.0440, -82.4934),
    "33618": (28.0845, -82.4741),
    "33619": (28.0001, -82.3860),
    "33621": (27.8895, -82.3995),
    "33624": (28.0640, -82.5219),
    "33625": (28.0400, -82.5600),
    "33626": (28.0640, -82.5600),
    "33629": (28.0179, -82.5548),
    "33647": (28.1429, -82.4894),
    "33673": (27.9526, -82.4585),
    "33674": (27.9526, -82.4585),
    "94102": (37.7786, -122.4160),  # SF
    "94103": (37.7715, -122.4110),
    "94104": (37.7904, -122.4019),
    "94105": (37.7859, -122.3919),
    "94107": (37.7723, -122.3940),
    "94108": (37.7893, -122.4069),
    "94109": (37.7920, -122.4200),
    "94110": (37.7577, -122.4103),
    "94111": (37.7948, -122.3924),
    "94112": (37.7278, -122.4363),
    "94114": (37.7609, -122.4350),
    "94115": (37.7872, -122.4360),
    "94116": (37.7444, -122.4860),
    "94117": (37.7667, -122.4413),
    "94118": (37.7806, -122.4530),
    "94121": (37.7769, -122.4943),
    "94122": (37.7569, -122.4870),
    "94123": (37.8004, -122.4369),
    "94124": (37.7307, -122.3879),
    "94127": (37.7293, -122.4577),
    "94129": (37.7986, -122.4634),
    "94131": (37.7490, -122.4425),
    "94132": (37.7236, -122.4816),
    "94133": (37.7992, -122.4088),
    "94134": (37.7187, -122.4109),
    "77001": (29.7545, -95.3535),   # Houston
    "77002": (29.7591, -95.3642),
    "77003": (29.7464, -95.3489),
    "77004": (29.7230, -95.3553),
    "77005": (29.7183, -95.4002),
    "77006": (29.7388, -95.4177),
    "77007": (29.7679, -95.4016),
    "77008": (29.7747, -95.4242),
    "77009": (29.7983, -95.3984),
    "77010": (29.7549, -95.3536),
    "77011": (29.7322, -95.2880),
    "77012": (29.7163, -95.2398),
    "77015": (29.7626, -95.1743),
    "77016": (29.7969, -95.3119),
    "77017": (29.7861, -95.2228),
    "77018": (29.7955, -95.4531),
    "77019": (29.7615, -95.4638),
    "77020": (29.7610, -95.2728),
    "77021": (29.6891, -95.3570),
    "77022": (29.7953, -95.3264),
    "77023": (29.7370, -95.2879),
    "77024": (29.7710, -95.5019),
    "77025": (29.6897, -95.4057),
    "77026": (29.7149, -95.3149),
    "77027": (29.7381, -95.4602),
    "77028": (29.7719, -95.2585),
    "77029": (29.7945, -95.2839),
    "77030": (29.7052, -95.3993),
    "77031": (29.6726, -95.4332),
    "77033": (29.6880, -95.2491),
    "77034": (29.6567, -95.1963),
    "77035": (29.7030, -95.4780),
    "77036": (29.7353, -95.5485),
    "77037": (29.7991, -95.1943),
    "77038": (29.8111, -95.4439),
    "77039": (29.8016, -95.1797),
    "77040": (29.8326, -95.4660),
    "77041": (29.8020, -95.5232),
    "77042": (29.7397, -95.5867),
    "77043": (29.8389, -95.4062),
    "77044": (29.8111, -95.1943),
    "77045": (29.6507, -95.4158),
    "77046": (29.7237, -95.4171),
    "77047": (29.6734, -95.3443),
    "77048": (29.6313, -95.3423),
    "77049": (29.7991, -95.1943),
    "77050": (29.7545, -95.3535),
    "77051": (29.7545, -95.3535),
    "77052": (29.7545, -95.3535),
    "77053": (29.6543, -95.3433),
    "77054": (29.7034, -95.3888),
    "77055": (29.8026, -95.5630),
    "77056": (29.7380, -95.4760),
    "77057": (29.7380, -95.5204),
    "77058": (29.7034, -95.3888),
    "77059": (29.6875, -95.1818),
    "77060": (29.8352, -95.4031),
    "77061": (29.6819, -95.3143),
    "77062": (29.7034, -95.3888),
    "77063": (29.7034, -95.3888),
    "77064": (29.8352, -95.4845),
    "77065": (29.8352, -95.4845),
    "77066": (29.8352, -95.4031),
    "77067": (29.8352, -95.4031),
    "77068": (29.8352, -95.4031),
    "77069": (29.8352, -95.4031),
    "77070": (29.8352, -95.4845),
    "77071": (29.8352, -95.4845),
    "77072": (29.8352, -95.4845),
    "77073": (29.8352, -95.4845),
    "77074": (29.8352, -95.4845),
    "77075": (29.8352, -95.4845),
    "77076": (29.8352, -95.4031),
    "77077": (29.8352, -95.4845),
    "77078": (29.8352, -95.1943),
    "77079": (29.8352, -95.4845),
    "77080": (29.8352, -95.4845),
    "77081": (29.8352, -95.4845),
    "77082": (29.8352, -95.4845),
    "77083": (29.8352, -95.4845),
    "77084": (29.8352, -95.4845),
    "77085": (29.7545, -95.3535),
    "77086": (29.7545, -95.3535),
    "77087": (29.7545, -95.3535),
    "77088": (29.7545, -95.3535),
    "77089": (29.7545, -95.3535),
    "77090": (29.7545, -95.3535),
    "77091": (29.7545, -95.3535),
    "77092": (29.7545, -95.3535),
    "77093": (29.7545, -95.3535),
    "77094": (29.7545, -95.3535),
    "77095": (29.7545, -95.3535),
    "77096": (29.7545, -95.3535),
}

BBOX_OFFSET = 0.02  # degrees offset for bbox from center

# SQL expression for address normalization (matches market_stats.py)
ADDRESS_NORM_SQL = "lower(regexp_replace(trim(address), '\\s+', ' ', 'g'))"


def _geocode_zip_to_bbox(zip_code: str, conn) -> Optional[tuple[float, float, float, float]]:
    """Convert a ZIP code to a bounding box for PadMapper queries.
    
    Tries zcta_geometries table first, falls back to hardcoded lookup.
    Returns (south, west, north, east) bbox.
    """
    # Primary: bbox of listings we already hold in this ZIP — covers exactly
    # the ZIP set the crawler works (there is no zcta_geometries table in
    # this database). Padded so edge listings don't clip the box.
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT min(latitude), min(longitude), max(latitude), max(longitude), count(*)
            FROM (
                SELECT latitude, longitude FROM listings
                WHERE zip_code = %s AND latitude IS NOT NULL AND longitude IS NOT NULL
                UNION ALL
                SELECT latitude, longitude FROM rental_listings
                WHERE zip_code = %s AND latitude IS NOT NULL AND longitude IS NOT NULL
            ) pts
            """,
            (zip_code, zip_code),
        )
        row = cur.fetchone()
        if row and row[4] and int(row[4]) >= 3:
            s, w, n, e = float(row[0]), float(row[1]), float(row[2]), float(row[3])
            pad = max(BBOX_OFFSET, (n - s) * 0.15, 0.01)
            return (s - pad, w - pad, n + pad, e + pad)
    except Exception as e:
        print(f"listing-bbox query failed: {e}")
        conn.rollback()
    
    # Fall back to hardcoded lookup
    if zip_code in _ZIP_COORDS:
        lat, lng = _ZIP_COORDS[zip_code]
        return (lat - BBOX_OFFSET, lng - BBOX_OFFSET, lat + BBOX_OFFSET, lng + BBOX_OFFSET)
    
    # If ZIP not found, try geocoding the ZIP as an address
    coords = geocode_address_census(zip_code)
    if coords:
        lat, lng = coords
        return (lat - BBOX_OFFSET, lng - BBOX_OFFSET, lat + BBOX_OFFSET, lng + BBOX_OFFSET)
    
    return None


def _check_dupe_address(address: str, conn) -> bool:
    """Check if address exists in rental_listings from any source in the last 14 days."""
    cur = conn.cursor()
    cur.execute(f"""
        SELECT 1 FROM rental_listings 
        WHERE {ADDRESS_NORM_SQL} = lower(regexp_replace(trim(%s), '\\s+', ' ', 'g'))
          AND listing_date > now() - interval '14 days' 
        LIMIT 1
    """, (address,))
    return cur.fetchone() is not None


def _scrape_padmapper(req: ScrapeRequest) -> dict:
    """Handle PadMapper scraping: geocode ZIP to bbox, fetch, normalize, upsert."""
    from adapters.padmapper import normalize, fetch_bbox, SourceBlockedError
    
    # Extract ZIP code from location
    location = req.location.strip()
    # Try to extract 5-digit ZIP
    import re
    zip_match = re.search(r'\b(\d{5})\b', location)
    if not zip_match:
        raise HTTPException(status_code=400, detail=f"Could not extract ZIP code from location: {location}")
    
    zip_code = zip_match.group(1)
    print(f"PadMapper: geocoding ZIP {zip_code} to bbox...")
    
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection failed")
    
    try:
        bbox = _geocode_zip_to_bbox(zip_code, conn)
        if not bbox:
            raise HTTPException(status_code=400, detail=f"Could not geocode ZIP {zip_code} to bbox")
        
        print(f"PadMapper: fetching listings for bbox {bbox}...")
        raw_listables = fetch_bbox(bbox)
        print(f"PadMapper: got {len(raw_listables)} raw listables")
        
        # Normalize all listables
        normalized = [n for n in (normalize(l) for l in raw_listables) if n is not None]
        print(f"PadMapper: {len(normalized)} normalized listings")
        
        if not normalized:
            return {"count": 0, "inserted": 0, "updated": 0, "skipped": 0}
        
        # Upsert into rental_listings
        cursor = conn.cursor()
        inserted = 0
        skipped = 0
        
        try:
            # Batch-fetch existing addresses for dedup (O(1) per listing instead of per-listing DB query)
            cursor.execute("""
                SELECT DISTINCT lower(regexp_replace(trim(address), '\\s+', ' ', 'g'))
                FROM rental_listings
                WHERE listing_date > now() - interval '14 days'
                   OR (address IS NOT NULL AND listing_date = CURRENT_DATE)
            """)
            existing_addrs = {row[0] for row in cursor.fetchall()}
            
            for listing in normalized:
                address = listing["address"]
                norm_addr = re.sub(r'\s+', ' ', address.strip().lower())
                
                if norm_addr in existing_addrs:
                    skipped += 1
                    continue
                
                # Insert
                cursor.execute("""
                    INSERT INTO rental_listings (
                        address, zip_code, price, bedrooms, bathrooms,
                        sqft, property_type, latitude, longitude, source, raw_data, listing_date
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_DATE)
                """, (
                    address, zip_code, listing["price"],
                    listing["bedrooms"], listing["bathrooms"], listing["sqft"],
                    listing["property_type"], listing["latitude"], listing["longitude"],
                    "padmapper", Json(listing)
                ))
                inserted += 1
            
            conn.commit()
            print(f"PadMapper: {inserted} inserted, {skipped} skipped")
            return {"count": len(normalized), "inserted": inserted, "updated": 0, "skipped": skipped}
        
        except Exception as e:
            conn.rollback()
            print(f"PadMapper DB Error: {e}")
            raise HTTPException(status_code=500, detail=f"PadMapper DB Error: {str(e)}")
        finally:
            cursor.close()
    
    except SourceBlockedError as e:
        raise HTTPException(status_code=429, detail=f"PadMapper blocked: {e}")
    finally:
        conn.close()
