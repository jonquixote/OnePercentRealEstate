from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
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

class ScrapeRequest(BaseModel):
    location: str
    listing_type: str = "for_sale"
    past_days: int = 30
    radius: Optional[float] = None
    mls_only: bool = False
    foreclosure: bool = False
    min_price: Optional[float] = None
    max_price: Optional[float] = None
    beds_min: Optional[int] = None
    baths_min: Optional[float] = None

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.post("/scrape")
def scrape_listings(req: ScrapeRequest):
    try:
        print(f"Scraping {req.location} ({req.listing_type})...")
        
        df = scrape_property(
            location=req.location,
            listing_type=req.listing_type,
            past_days=req.past_days,
            radius=req.radius,
            mls_only=req.mls_only,
            foreclosure=req.foreclosure,
            extra_property_data=True,
        )
        
        is_rental = req.listing_type == 'for_rent'
        is_sold = req.listing_type == 'sold'
        target_table = 'rental_listings' if is_rental else 'sold_listings' if is_sold else 'listings'
        print(f"Target table: {target_table}")
        
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
                        req.listing_type, Json(images), Json(raw_data), raw_data.get("lat"), raw_data.get("lon"),
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
