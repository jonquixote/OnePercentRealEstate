from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
from homeharvest import scrape_property
import pandas as pd
import psycopg2
from psycopg2.extras import Json
import os
import urllib.parse
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from time import sleep
from enrichment import extract_enrichment

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

CENSUS_BENCHMARK = 'Public_AR_Currenty'

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
            foreclosure=req.foreclosure
        )
        
        is_rental = req.listing_type == 'for_rent'
        target_table = 'rental_listings' if is_rental else 'listings'
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
            zip_code = str(zip_raw).split('.')[0] if zip_raw else ""
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
                zip_code = str(zip_raw).split('.')[0] if zip_raw else ""
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
                            list_date, price_per_sqft, hoa_fee, tax_annual_amount, property_url
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
                            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                        FROM classify_sale_type(%s::jsonb, %s) c,
                             LATERAL (
                                 SELECT NULLIF(regexp_replace(regexp_replace(lower(trim(%s)), '[.,#]', '', 'g'), '\\s+', ' ', 'g'), '') AS address_norm
                             ) n
                        ON CONFLICT (address, listing_type, sale_type)
                        DO UPDATE SET
                            price = EXCLUDED.price,
                            bedrooms = EXCLUDED.bedrooms,
                            bathrooms = EXCLUDED.bathrooms,
                            sqft = EXCLUDED.sqft,
                            year_built = EXCLUDED.year_built,
                            property_type = EXCLUDED.property_type,
                            images = EXCLUDED.images,
                            raw_data = EXCLUDED.raw_data,
                            latitude = EXCLUDED.latitude,
                            longitude = EXCLUDED.longitude,
                            sale_type_source = EXCLUDED.sale_type_source,
                            sale_type_signal = EXCLUDED.sale_type_signal,
                            sale_type_confidence = EXCLUDED.sale_type_confidence,
                            address_norm = EXCLUDED.address_norm,
                            address_hash = EXCLUDED.address_hash,
                            county = EXCLUDED.county,
                            fips_code = EXCLUDED.fips_code,
                            neighborhoods = EXCLUDED.neighborhoods,
                            last_sold_price = EXCLUDED.last_sold_price,
                            last_sold_date = EXCLUDED.last_sold_date,
                            assessed_value = EXCLUDED.assessed_value,
                            estimated_value = EXCLUDED.estimated_value,
                            description = EXCLUDED.description,
                            style = EXCLUDED.style,
                            new_construction = EXCLUDED.new_construction,
                            list_date = EXCLUDED.list_date,
                            price_per_sqft = EXCLUDED.price_per_sqft,
                            hoa_fee = EXCLUDED.hoa_fee,
                            tax_annual_amount = EXCLUDED.tax_annual_amount,
                            property_url = EXCLUDED.property_url,
                            updated_at = NOW()
                        WHERE listings.price IS DISTINCT FROM EXCLUDED.price
                           OR listings.bedrooms IS DISTINCT FROM EXCLUDED.bedrooms
                           OR listings.bathrooms IS DISTINCT FROM EXCLUDED.bathrooms
                           OR listings.sqft IS DISTINCT FROM EXCLUDED.sqft
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
