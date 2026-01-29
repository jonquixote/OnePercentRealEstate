import os
import argparse
import json
import pandas as pd
import sys
import requests
import urllib.parse
from time import sleep
from homeharvest import scrape_property
import psycopg2
from psycopg2.extras import Json
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
DEFAULT_USER_ID = os.getenv("DEFAULT_USER_ID")
MAPBOX_TOKEN = os.getenv("NEXT_PUBLIC_MAPBOX_TOKEN")

if not DATABASE_URL:
    # Construct from parts as fallback
    DB_USER = os.getenv("DB_USER", "postgres")
    DB_PASS = os.getenv("DB_PASS", "root_password_change_me_please")
    DB_HOST = os.getenv("DB_HOST", "infrastructure-postgres-1")
    DB_PORT = os.getenv("DB_PORT", "5432")
    DB_NAME = os.getenv("DB_NAME", "postgres")
    DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASS}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

def get_db_connection():
    try:
        conn = psycopg2.connect(DATABASE_URL)
        return conn
    except Exception as e:
        print(f"Error connecting to database: {e}", file=sys.stderr)
        return None

def geocode_address(address):
    """Geocodes an address using Mapbox."""
    if not MAPBOX_TOKEN:
        return None
        
    try:
        encoded = urllib.parse.quote(address)
        url = f"https://api.mapbox.com/geocoding/v5/mapbox.places/{encoded}.json"
        params = {
            "access_token": MAPBOX_TOKEN,
            "country": "US",
            "limit": 1
        }
        
        resp = requests.get(url, params=params, timeout=5)
        
        if resp.status_code == 200:
            data = resp.json()
            if data.get("features") and len(data["features"]) > 0:
                coords = data["features"][0]["center"]
                return (coords[1], coords[0])  # [lon, lat] -> (lat, lon)
    except Exception as e:
        print(f"Geocode error: {e}", file=sys.stderr)
    
    return None

def get_property_type(row):
    """Robust extraction of property type from multiple possible fields."""
    return (
        row.get('style') or 
        row.get('property_type') or 
        row.get('home_type') or 
        row.get('prop_type')
    )

def process_listing(row, user_id):
    """
    Normalizes a dataframe row into a dictionary for database insertion.
    Captures all available data fields.
    """
    try:
        price = row.get('list_price')
        if pd.isna(price) or price is None:
            price = 0
            
        # Robust zip code handling
        zip_raw = row.get('zip_code')
        if pd.notna(zip_raw):
            zip_code = str(zip_raw).split('.')[0]
        else:
            zip_code = ""

        bedrooms = row.get('beds') if pd.notna(row.get('beds')) else None
        bathrooms = row.get('baths') if pd.notna(row.get('baths')) else None
        sqft = row.get('sqft') if pd.notna(row.get('sqft')) else None
        year_built = row.get('year_built') if pd.notna(row.get('year_built')) else None
        
        address = f"{row.get('street', '')}, {row.get('city', '')}, {row.get('state', '')} {zip_code}".strip(", ")
        
        # NOTE: We DO NOT calculate estimated_rent here anymore.
        # We let the database trigger 'trigger_calculate_smart_rent' handle it on insert.
        # This ensures the most up-to-date logic (including triangulation) is used.
        estimated_rent = None 
        
        financial_snapshot = {
            "price": price,
            "estimated_rent": estimated_rent, # Will be populated by DB trigger
            "sqft": sqft,
            "year_built": year_built,
            "bedrooms": bedrooms,
            "bathrooms": bathrooms
        }

        # Handle Images
        images = []
        if pd.notna(row.get('primary_photo')):
            images.append(row['primary_photo'])
        
        if pd.notna(row.get('alt_photos')):
            alts = str(row['alt_photos'])
            if alts and alts.lower() != 'nan':
                images.extend([url.strip() for url in alts.split(',') if url.strip()])

        # Handle Raw Data (Clean for JSON)
        # row is already a dict now (from records)
        raw_data = row.copy()
        for k, v in raw_data.items():
            if isinstance(v, (list, tuple)):
                continue 
            
            if pd.isna(v):
                raw_data[k] = None
            elif hasattr(v, 'isoformat'): 
                raw_data[k] = v.isoformat()
        
        # Geocode
        coords = geocode_address(address)
        if coords:
            raw_data["lat"] = coords[0]
            raw_data["lon"] = coords[1]
        else:
            # Fallback to scraped lat/lon if mapbox fails
            if pd.notna(row.get('latitude')) and pd.notna(row.get('longitude')):
                raw_data["lat"] = row['latitude']
                raw_data["lon"] = row['longitude']
            else:
                raw_data["lat"] = None
                raw_data["lon"] = None
            
        sold_price = row.get('sold_price') if pd.notna(row.get('sold_price')) else None
        sold_date = row.get('last_sold_date') if pd.notna(row.get('last_sold_date')) else None

        # Build comprehensive data object
        data = {
            "address": address,
            "city": row.get('city'),
            "state": row.get('state'),
            "zip_code": zip_code,
            "price": price, # Correct column name for Postgres
            "estimated_rent": None, # Trigger will populate
            "expense_ratio": 50,
            "financial_snapshot": financial_snapshot,
            "status": "watch",
            "user_id": user_id,
            "images": images,
            "raw_data": raw_data,
            "sold_price": sold_price,
            "sold_date": sold_date,
            "property_type": get_property_type(row),
            "bedrooms": bedrooms,
            "bathrooms": bathrooms,
            "sqft": sqft,
            "year_built": year_built,
            
            # New Fields Mapping
            "mls_id": str(row.get('listing_id')) if pd.notna(row.get('listing_id')) else None,
            "mls_status": row.get('status'), # 'FOR_SALE', 'SOLD', etc
            "days_on_market": int(row.get('days_on_mls')) if pd.notna(row.get('days_on_mls')) else None,
            "hoa_fee": float(row.get('hoa_fee')) if pd.notna(row.get('hoa_fee')) else None,
            "tax_annual_amount": float(row.get('tax_annual_amount') or row.get('tax_assessed_value', 0) * 0.02) if pd.notna(row.get('tax_annual_amount')) else None,
            "agent_name": row.get('agent_name'),
            "agent_email": row.get('agent_email'),
            "agent_phone": str(row.get('agent_phones')) if pd.notna(row.get('agent_phones')) else None,
            "broker_name": row.get('broker_name') or row.get('office_name'),
            "lot_size_acres": float(row.get('lot_sqft', 0)) / 43560.0 if pd.notna(row.get('lot_sqft')) else None,
            "stories": int(row.get('stories')) if pd.notna(row.get('stories')) else None,
            "garage_spaces": int(row.get('garage_spaces')) if pd.notna(row.get('garage_spaces')) else None,
            
            # Coordinates
            "latitude": raw_data["lat"],
            "longitude": raw_data["lon"]
        }
        
        # Alias 'listing_price' to 'price' for insertion matching DB schema
        data['price'] = data['listing_price']
        
        return data

    except Exception as e:
        print(f"Error processing listing: {e}", file=sys.stderr)
        return None

def process_rental(row):
    """
    Normalizes a dataframe row into a dictionary for rental_listings table.
    """
    try:
        price = row.get('list_price')
        if pd.isna(price) or price <= 0:
            return None
            
        zip_raw = row.get('zip_code')
        zip_code = str(zip_raw).split('.')[0] if pd.notna(zip_raw) else ""
        
        address = f"{row.get('street', '')}, {row.get('city', '')}, {row.get('state', '')} {zip_code}".strip(", ")
        
        raw_data = dict(row)  # row is already a dict from cleaned_records
        for k, v in raw_data.items():
            if isinstance(v, (list, tuple)):
                continue
            if pd.isna(v):
                raw_data[k] = None
            elif hasattr(v, 'isoformat'):
                raw_data[k] = v.isoformat()
        
        coords = geocode_address(address)
        lat, lon = (None, None)
        if coords:
            lat, lon = coords
            raw_data["lat"] = lat
            raw_data["lon"] = lon
        else:
            if pd.notna(row.get('latitude')) and pd.notna(row.get('longitude')):
               lat = row['latitude']
               lon = row['longitude']
               raw_data["lat"] = lat
               raw_data["lon"] = lon
            else:
               raw_data["lat"] = None
               raw_data["lon"] = None

        return {
            "address": address,
            "zip_code": str(zip_code),
            "city": row.get('city'),
            "state": row.get('state'),
            "price": price,
            "bedrooms": row.get('beds') if pd.notna(row.get('beds')) else None,
            "bathrooms": row.get('baths') if pd.notna(row.get('baths')) else None,
            "sqft": row.get('sqft') if pd.notna(row.get('sqft')) else None,
            "property_type": get_property_type(row),
            "latitude": lat,
            "longitude": lon,
            "source": "homeharvest",
            "raw_data": raw_data
        }
    except Exception as e:
        print(f"Error processing rental: {e}", file=sys.stderr)
        return None

def run_scraper(args):
    try:
        tasks = []
        if args.listing_type == 'for_sale':
            tasks.append({'type': 'for_sale', 'table': 'properties'})
            tasks.append({'type': 'for_rent', 'table': 'rental_listings'})
        else:
            table = 'rental_listings' if args.listing_type == 'for_rent' else 'properties'
            tasks.append({'type': args.listing_type, 'table': table})

        total_found = 0
        total_inserted = 0
        total_skipped = 0
        all_errors = []

        for task in tasks:
            l_type = task['type']
            target_table = task['table']
            
            print(f"Scraping {args.location} (type={l_type}, past={args.past_days})...", file=sys.stderr)

            try:
                properties = scrape_property(
                    location=args.location,
                    listing_type=l_type,
                    past_days=args.past_days
                )
            except Exception as scrape_err:
                 print(f"HomeHarvest Error: {scrape_err}", file=sys.stderr)
                 continue
            
            if properties is None or properties.empty:
                print(f"No {l_type} properties found.", file=sys.stderr)
                continue

            # Deduplicate columns immediately to avoid ambiguity in access
            properties = properties.loc[:, ~properties.columns.duplicated()]

            # Calculate baths
            df = properties
            if 'full_baths' in df.columns and 'half_baths' in df.columns:
                df['baths'] = df['full_baths'].fillna(0) + df['half_baths'].fillna(0) * 0.5
            elif 'full_baths' in df.columns:
                df['baths'] = df['full_baths'].fillna(0)
            else:
                df['baths'] = 0
            
            if args.min_price and target_table == 'properties':
                df = df[df['list_price'] >= args.min_price]
            if args.max_price and target_table == 'properties':
                df = df[df['list_price'] <= args.max_price]
            if args.beds:
                df = df[df['beds'] >= args.beds]
            if args.baths:
                df = df[df['baths'] >= args.baths]
                
            if args.limit and args.limit > 0:
                df = df.head(args.limit)
            
            # Deduplicate columns (Already done above)
            
            # Convert to list of dicts to avoid pandas Series ambiguity and type issues entirely
            # This is much safer than iterrows for mixed types
            records = df.to_dict(orient='records')
            
            # Sanitize records (NaN -> None)
            cleaned_records = []
            for rec in records:
                clean_rec = {}
                for k, v in rec.items():
                    # Handle NaN/None/pd.NA
                    # Handle NaN/None/pd.NA
                    # Check for complex types first to avoid 'truth value ambiguous' on arrays/lists
                    if isinstance(v, (list, tuple, dict, set)):
                        clean_rec[k] = v
                    elif pd.isna(v):
                        clean_rec[k] = None
                    else:
                        clean_rec[k] = v
                cleaned_records.append(clean_rec)

            count = len(cleaned_records)
            total_found += count
            
            if count == 0:
                print(f"No {l_type} properties matched filters.", file=sys.stderr)
                continue

            user_id = DEFAULT_USER_ID
            
            # Database Connection
            conn = get_db_connection()
            if not conn:
                print("Failed to connect to DB", file=sys.stderr)
                return

            cursor = conn.cursor()

            try:
                for row in cleaned_records:
                    if target_table == 'listings': # Previously check for 'properties'
                        data = process_listing(row, user_id)
                        table_name = "listings"
                    else:
                        data = process_rental(row)
                        table_name = "rental_listings"
                    
                    if not data or not data.get('address'):
                        continue

                    # Serialize JSON/Dict fields for Psycopg2
                    if 'financial_snapshot' in data and isinstance(data['financial_snapshot'], dict):
                        data['financial_snapshot'] = Json(data['financial_snapshot'])
                    if 'raw_data' in data and isinstance(data['raw_data'], dict):
                        data['raw_data'] = Json(data['raw_data'])
                    
                    print(f"Processing ({l_type}): {data['address']}", file=sys.stderr)
                    
                    try:
                        if table_name == 'listings':
                            # Check existing
                            cursor.execute("SELECT id, price, listing_status, updated_at FROM listings WHERE address = %s", (data['address'],))
                            existing = cursor.fetchone()
                            
                            if existing:
                                prop_id, old_price, old_status, _ = existing
                                new_price = float(data.get('price') or 0)
                                old_price_val = float(old_price or 0)
                                
                                # Check logic
                                if abs(old_price_val - new_price) < 1.0 and old_status == data.get('status'):
                                    print(f"Skipping unchanged: {data['address']}", file=sys.stderr)
                                    total_skipped += 1
                                    continue
                                
                                print(f"Updating: {data['address']}", file=sys.stderr)
                                
                                # Remove user_id to prevent overwrite
                                if 'user_id' in data:
                                    del data['user_id']
                                
                                cols = list(data.keys())
                                set_clause = ", ".join([f"{col} = %s" for col in cols])
                                sql = f"UPDATE listings SET {set_clause}, updated_at = NOW() WHERE id = %s"
                                cursor.execute(sql, list(data.values()) + [prop_id])
                                total_inserted += 1
                            else:
                                print(f"Inserting: {data['address']}", file=sys.stderr)
                                cols = list(data.keys())
                                placeholders = ", ".join(["%s"] * len(cols))
                                sql = f"INSERT INTO listings ({', '.join(cols)}) VALUES ({placeholders})"
                                cursor.execute(sql, list(data.values()))
                                total_inserted += 1
                        else:
                            # Rental Listings Upsert
                            print(f"Upserting Rental: {data['address']}", file=sys.stderr)
                            cols = list(data.keys())
                            placeholders = ", ".join(["%s"] * len(cols))
                            # Update all except address
                            update_set = ", ".join([f"{col} = EXCLUDED.{col}" for col in cols if col != 'address'])
                            
                            sql = f"""
                            INSERT INTO rental_listings ({', '.join(cols)}) 
                            VALUES ({placeholders})
                            ON CONFLICT (address) DO UPDATE SET {update_set}, updated_at = NOW()
                            """
                            cursor.execute(sql, list(data.values()))
                            total_inserted += 1

                        conn.commit()
                            
                    except Exception as e:
                        conn.rollback()
                        print(f"INSERT ERROR: {data['address']} - {str(e)}", file=sys.stderr)
                        all_errors.append(f"Error inserting {data['address']}: {str(e)}")
            finally:
                if cursor: cursor.close()
                if conn: conn.close()

        print(json.dumps({
            "message": "Scrape complete", 
            "found": total_found, 
            "inserted": total_inserted, 
            "skipped": total_skipped,
            "errors": all_errors[:5]
        }))

    except Exception as e:
        print(f"CRITICAL ERROR: {str(e)}", file=sys.stderr)
        print(json.dumps({"error": str(e), "found": 0, "inserted": 0}))
        sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Real Estate Scraper")
    parser.add_argument("--location", required=True, help="Zip code or City, State")
    parser.add_argument("--min_price", type=float, help="Minimum price")
    parser.add_argument("--max_price", type=float, help="Maximum price")
    parser.add_argument("--beds", type=int, help="Minimum bedrooms")
    parser.add_argument("--baths", type=float, help="Minimum bathrooms")
    parser.add_argument("--limit", type=int, default=10, help="Max results. -1 for unlimited.")
    
    parser.add_argument("--site_name", help="Ignored (HomeHarvest handles sources)")
    parser.add_argument("--listing_type", default="for_sale", help="for_sale, for_rent, sold")
    parser.add_argument("--past_days", type=int, default=30, help="Days of history")
    
    args = parser.parse_args()
    run_scraper(args)