import os
import argparse
import json
import pandas as pd
import sys
import psycopg2
from psycopg2.extras import Json
from homeharvest import scrape_property
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    # Fallback to constructing from parts if DATABASE_URL not set
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

def process_rental(row):
    """
    Normalizes a dataframe row into a dictionary for rental_listings table.
    Extracts all available features for ML training.
    """
    try:
        price = row['list_price']
        if pd.isna(price) or price <= 0:
            return None
            
        zip_code = row['zip_code']
        address = f"{row['street']}, {row['city']}, {row['state']} {zip_code}"
        
        # Handle Raw Data
        raw_data = row.to_dict()
        for k, v in raw_data.items():
            if isinstance(v, (list, tuple)):
                continue
            if pd.isna(v):
                raw_data[k] = None
            elif hasattr(v, 'isoformat'):
                raw_data[k] = v.isoformat()
        
        # Extract additional ML features from raw data
        year_built = row.get('year_built') if pd.notna(row.get('year_built')) else None
        lot_sqft = row.get('lot_sqft') if pd.notna(row.get('lot_sqft')) else None
        hoa_fee = row.get('hoa_fee') if pd.notna(row.get('hoa_fee')) else None
        
        # Calculate days on market if list_date available
        days_on_market = None
        if pd.notna(row.get('list_date')):
            try:
                list_date = pd.to_datetime(row['list_date'])
                days_on_market = (pd.Timestamp.now() - list_date).days
            except:
                pass
        
        # Detect amenities from description or flags
        description = str(row.get('text', '') or '').lower()
        has_garage = 'garage' in description or pd.notna(row.get('parking_garage'))
        has_ac = 'central air' in description or 'a/c' in description or 'ac' in description
        has_pool = 'pool' in description
        pet_friendly = 'pet' in description and 'no pet' not in description
            
        return {
            "address": address,
            "zip_code": str(zip_code),
            "city": row['city'],
            "state": row['state'],
            "price": price,
            "bedrooms": row['beds'] if pd.notna(row['beds']) else None,
            "bathrooms": row['baths'] if pd.notna(row['baths']) else None,
            "sqft": row['sqft'] if pd.notna(row['sqft']) else None,
            "property_type": row['style'] if pd.notna(row.get('style')) else None,
            "latitude": row['latitude'] if pd.notna(row['latitude']) else None,
            "longitude": row['longitude'] if pd.notna(row['longitude']) else None,
            "year_built": year_built,
            "lot_sqft": lot_sqft,
            "hoa_fee": hoa_fee,
            "days_on_market": days_on_market,
            "parking_garage": has_garage,
            "has_ac": has_ac,
            "has_pool": has_pool,
            "pet_friendly": pet_friendly,
            "source": "homeharvest",
            "raw_data": json.dumps(raw_data) # Postgres needs JSON string or Json object
        }
    except Exception as e:
        print(f"Error processing rental: {e}", file=sys.stderr)
        return None

def fetch_rentals(location, past_days=30):
    print(f"Fetching rentals for {location}...", file=sys.stderr)
    
    properties = scrape_property(
        location=location,
        listing_type="for_rent",
        past_days=past_days,
    )
    
    if properties is None or properties.empty:
        print(json.dumps({"message": "No rentals found", "count": 0}))
        return

    # Calculate baths if needed
    df = properties
    if 'full_baths' in df.columns and 'half_baths' in df.columns:
        df['baths'] = df['full_baths'].fillna(0) + df['half_baths'].fillna(0) * 0.5
    elif 'full_baths' in df.columns:
        df['baths'] = df['full_baths'].fillna(0)
    else:
        if 'baths' not in df.columns:
            df['baths'] = None

    inserted_count = 0
    conn = get_db_connection()
    
    if not conn:
        print("Failed to connect to DB, skipping insertions")
        return

    cursor = conn.cursor()
    
    try:
        for index, row in df.iterrows():
            data = process_rental(row)
            if data:
                try:
                    # Upsert rental listing
                    query = """
                        INSERT INTO rental_listings (
                            address, zip_code, city, state, price, bedrooms, bathrooms, sqft,
                            property_type, latitude, longitude, year_built, lot_sqft, hoa_fee,
                            days_on_market, parking_garage, has_ac, has_pool, pet_friendly,
                            source, raw_data, created_at, updated_at
                        ) VALUES (
                            %(address)s, %(zip_code)s, %(city)s, %(state)s, %(price)s, %(bedrooms)s, %(bathrooms)s, %(sqft)s,
                            %(property_type)s, %(latitude)s, %(longitude)s, %(year_built)s, %(lot_sqft)s, %(hoa_fee)s,
                            %(days_on_market)s, %(parking_garage)s, %(has_ac)s, %(has_pool)s, %(pet_friendly)s,
                            %(source)s, %(raw_data)s, NOW(), NOW()
                        )
                        ON CONFLICT (address) DO UPDATE SET
                            price = EXCLUDED.price,
                            days_on_market = EXCLUDED.days_on_market,
                            updated_at = NOW();
                    """
                    cursor.execute(query, data)
                    inserted_count += 1
                except Exception as e:
                    print(f"Error inserting {data['address']}: {e}", file=sys.stderr)
                    conn.rollback() # Rollback tuple error to allow continuing
        
        conn.commit()
    except Exception as e:
        print(f"Batch processing error: {e}", file=sys.stderr)
        conn.rollback()
    finally:
        cursor.close()
        conn.close()

    print(json.dumps({
        "message": "Rental fetch complete",
        "found": len(df),
        "inserted": inserted_count
    }))

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--location", required=True)
    parser.add_argument("--past_days", type=int, default=30)
    args = parser.parse_args()
    
    fetch_rentals(args.location, args.past_days)
