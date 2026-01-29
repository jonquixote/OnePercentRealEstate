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

MAPBOX_TOKEN = os.getenv("NEXT_PUBLIC_MAPBOX_TOKEN")
DEFAULT_USER_ID = os.getenv("DEFAULT_USER_ID")

def get_db_connection():
    try:
        return psycopg2.connect(DATABASE_URL)
    except Exception as e:
        print(f"DB Connect Error: {e}")
        return None

def geocode_address(address):
    """Geocodes an address using Mapbox."""
    if not MAPBOX_TOKEN:
        return None
    try:
        encoded = urllib.parse.quote(address)
        url = f"https://api.mapbox.com/geocoding/v5/mapbox.places/{encoded}.json"
        params = {"access_token": MAPBOX_TOKEN, "country": "US", "limit": 1}
        resp = requests.get(url, params=params, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("features") and len(data["features"]) > 0:
                coords = data["features"][0]["center"]
                return (coords[1], coords[0])  # [lon, lat] -> (lat, lon)
    except Exception as e:
        print(f"Geocode error: {e}")
    return None

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
        
        if df is None or (hasattr(df, "empty") and df.empty):
            print(f"No results for {req.location}")
            return {"count": 0, "inserted": 0, "skipped": 0}

        print(f"df shape: {df.shape}")

        # Deduplicate columns
        df = df.loc[:, ~df.columns.duplicated()]

        # Calculate baths
        if 'full_baths' in df.columns and 'half_baths' in df.columns:
            df['baths'] = df['full_baths'].fillna(0) + df['half_baths'].fillna(0) * 0.5
        elif 'full_baths' in df.columns:
            df['baths'] = df['full_baths'].fillna(0)
        else:
            df['baths'] = 0

        # Apply filters
        if req.min_price is not None:
            df = df[df['list_price'] >= req.min_price]
        if req.max_price is not None:
            df = df[df['list_price'] <= req.max_price]
        if req.beds_min is not None:
            df = df[df['beds'] >= req.beds_min]

        # Convert to records
        records = df.to_dict(orient='records')
        
        # Clean NaN values
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
            return {"count": 0, "inserted": 0, "skipped": 0}

        # Connect to DB
        conn = get_db_connection()
        if not conn:
            raise HTTPException(status_code=500, detail="Database connection failed")

        cursor = conn.cursor()
        inserted = 0
        skipped = 0

        try:
            for row in clean_records:
                # Build address
                zip_raw = row.get('zip_code')
                zip_code = str(zip_raw).split('.')[0] if zip_raw else ""
                address = f"{row.get('street', '')}, {row.get('city', '')}, {row.get('state', '')} {zip_code}".strip(", ")
                
                if not address or address == "":
                    skipped += 1
                    continue

                # Check if exists
                cursor.execute("SELECT id, price FROM listings WHERE address = %s", (address,))
                existing = cursor.fetchone()

                price = row.get('list_price') or 0
                bedrooms = row.get('beds')
                bathrooms = row.get('baths')
                sqft = row.get('sqft')
                year_built = row.get('year_built')

                # Prepare raw_data
                raw_data = dict(row)
                for k, v in raw_data.items():
                    if isinstance(v, (list, tuple, dict, set)):
                        continue
                    if pd.isna(v) if hasattr(pd, 'isna') else v != v:
                        raw_data[k] = None
                    elif hasattr(v, 'isoformat'):
                        raw_data[k] = v.isoformat()

                # Geocode
                coords = geocode_address(address)
                if coords:
                    raw_data["lat"], raw_data["lon"] = coords
                else:
                    raw_data["lat"] = row.get('latitude')
                    raw_data["lon"] = row.get('longitude')

                # Images
                images = []
                if row.get('primary_photo'):
                    images.append(row['primary_photo'])
                if row.get('alt_photos'):
                    alts = str(row['alt_photos'])
                    if alts and alts.lower() != 'nan':
                        images.extend([u.strip() for u in alts.split(',') if u.strip()])

                if existing:
                    # Update if price changed
                    old_price = float(existing[1] or 0)
                    new_price = float(price or 0)
                    if abs(old_price - new_price) < 1.0:
                        skipped += 1
                        continue
                    
                    cursor.execute("""
                        UPDATE listings SET 
                            price = %s, bedrooms = %s, bathrooms = %s, sqft = %s, 
                            year_built = %s, property_type = %s, images = %s, 
                            raw_data = %s, latitude = %s, longitude = %s, updated_at = NOW()
                        WHERE id = %s
                    """, (
                        price, bedrooms, bathrooms, sqft, year_built,
                        get_property_type(row), images, Json(raw_data),
                        raw_data.get("lat"), raw_data.get("lon"), existing[0]
                    ))
                    inserted += 1
                else:
                    # Insert new
                    cursor.execute("""
                        INSERT INTO listings (
                            address, city, state, zip_code, price, bedrooms, bathrooms,
                            sqft, year_built, property_type, images, raw_data, 
                            latitude, longitude, status, user_id
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """, (
                        address, row.get('city'), row.get('state'), zip_code, price,
                        bedrooms, bathrooms, sqft, year_built, get_property_type(row),
                        images, Json(raw_data), raw_data.get("lat"), raw_data.get("lon"),
                        'watch', DEFAULT_USER_ID
                    ))
                    inserted += 1

                conn.commit()

        except Exception as e:
            conn.rollback()
            print(f"DB Error: {e}")
            raise HTTPException(status_code=500, detail=f"DB Error: {str(e)}")
        finally:
            cursor.close()
            conn.close()

        print(f"Completed {req.location}: {inserted} inserted/updated, {skipped} skipped")
        return {"count": len(clean_records), "inserted": inserted, "skipped": skipped}

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error scraping {req.location}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
