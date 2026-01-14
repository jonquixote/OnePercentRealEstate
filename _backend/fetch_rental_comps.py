import os
import argparse
import json
import pandas as pd
import sys
from homeharvest import scrape_property
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print(json.dumps({"error": "Missing Supabase credentials"}))
    exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def process_rental(row):
    """
    Normalizes a dataframe row into a dictionary for rental_listings table.
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
            
        return {
            "address": address,
            "zip_code": str(zip_code),
            "city": row['city'],
            "state": row['state'],
            "price": price,
            "bedrooms": row['beds'] if pd.notna(row['beds']) else None,
            "bathrooms": row['baths'] if pd.notna(row['baths']) else None,
            "sqft": row['sqft'] if pd.notna(row['sqft']) else None,
            "property_type": row['style'] if pd.notna(row['style']) else None,
            "latitude": row['latitude'] if pd.notna(row['latitude']) else None,
            "longitude": row['longitude'] if pd.notna(row['longitude']) else None,
            "source": "homeharvest",
            "raw_data": raw_data
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
    
    for index, row in df.iterrows():
        data = process_rental(row)
        if data:
            try:
                # Upsert based on address (and ideally date, but address is unique constraint in our schema for now)
                # We used UNIQUE(address, listing_date) in schema
                supabase.table("rental_listings").upsert(data, on_conflict="address, listing_date").execute()
                inserted_count += 1
            except Exception as e:
                print(f"Error inserting {data['address']}: {e}", file=sys.stderr)

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
