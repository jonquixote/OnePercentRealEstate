import os
import argparse
import json
import pandas as pd
import sys
from homeharvest import scrape_property
from supabase import create_client, Client
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
DEFAULT_USER_ID = os.getenv("DEFAULT_USER_ID")

if not SUPABASE_URL or not SUPABASE_KEY:
    print(json.dumps({"error": "Missing Supabase credentials"}))
    exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def get_safmr_rent(zip_code, bedrooms):
    """
    Fetches SAFMR rent for a zip code and bedroom count from Supabase.
    """
    try:
        response = supabase.table("market_benchmarks").select("safmr_data").eq("zip_code", zip_code).execute()
        if response.data:
            safmr = response.data[0].get("safmr_data", {})
            key = f"{int(bedrooms)}br"
            return safmr.get(key)
    except Exception:
        pass
    return None

def process_listing(row, user_id):
    """
    Normalizes a dataframe row into a dictionary for Supabase insertion.
    """
    try:
        price = row['list_price']
        zip_code = str(row['zip_code']).split('.')[0] # Handle float 44111.0 -> "44111"
        bedrooms = row['beds'] if pd.notna(row['beds']) else 2
        
        address = f"{row['street']}, {row['city']}, {row['state']} {zip_code}"
        
        # Debug logging
        print(f"DEBUG: Looking up SAFMR for zip '{zip_code}' (type: {type(zip_code)})", file=sys.stderr)
        
        estimated_rent = get_safmr_rent(zip_code, bedrooms)
        
        print(f"DEBUG: SAFMR Result: {estimated_rent}", file=sys.stderr)

        if not estimated_rent:
             print(f"WARNING: No SAFMR data for zip {zip_code}. Using 0.8% rule.", file=sys.stderr)
             estimated_rent = price * 0.008 
        
        financial_snapshot = {
            "price": price,
            "estimated_rent": estimated_rent,
            "sqft": row['sqft'],
            "year_built": row['year_built'],
            "bedrooms": bedrooms,
            "bathrooms": row['baths']
        }

        # Handle Images
        images = []
        if pd.notna(row.get('primary_photo')):
            images.append(row['primary_photo'])
        
        if pd.notna(row.get('alt_photos')):
            # alt_photos might be a comma-separated string or a list? 
            # HomeHarvest usually returns a string "url1, url2"
            alts = str(row['alt_photos'])
            if alts and alts.lower() != 'nan':
                images.extend([url.strip() for url in alts.split(',') if url.strip()])

        # Handle Raw Data (Clean for JSON)
        # Convert Series to dict and handle NaN/NaT
        raw_data = row.to_dict()
        for k, v in raw_data.items():
            # Check for list/array first to avoid ambiguity error
            if isinstance(v, (list, tuple)):
                continue # Lists are fine for JSON usually, or we can sanitize them if needed
            
            if pd.isna(v):
                raw_data[k] = None
            elif hasattr(v, 'isoformat'): # Handle dates
                raw_data[k] = v.isoformat()
            
        return {
            "address": address,
            "listing_price": price,
            "estimated_rent": estimated_rent,
            "expense_ratio": 50,
            "financial_snapshot": financial_snapshot,
            "status": "watch",
            "user_id": user_id,
            "images": images,
            "raw_data": raw_data
        }
    except Exception as e:
        print(f"Error processing listing: {e}")
        return None

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

def run_scraper(args):
    try:
        # Determine scrape tasks
        tasks = []
        if args.listing_type == 'for_sale':
            # If user wants for_sale, we scrape BOTH for_sale and for_rent
            tasks.append({'type': 'for_sale', 'table': 'properties'})
            tasks.append({'type': 'for_rent', 'table': 'rental_listings'})
        else:
            # Otherwise just scrape what they asked for (e.g. sold, or explicit for_rent)
            table = 'rental_listings' if args.listing_type == 'for_rent' else 'properties'
            tasks.append({'type': args.listing_type, 'table': table})

        total_found = 0
        total_inserted = 0
        all_errors = []

        for task in tasks:
            l_type = task['type']
            target_table = task['table']
            
            print(f"Scraping {args.location} (type={l_type}, past={args.past_days})...", file=sys.stderr)

            # HomeHarvest fetches listings
            properties = scrape_property(
                location=args.location,
                listing_type=l_type,
                past_days=args.past_days
            )
            
            if properties is None or properties.empty:
                print(f"No {l_type} properties found.", file=sys.stderr)
                continue

            # Calculate baths column
            df = properties
            if 'full_baths' in df.columns and 'half_baths' in df.columns:
                df['baths'] = df['full_baths'].fillna(0) + df['half_baths'].fillna(0) * 0.5
            elif 'full_baths' in df.columns:
                df['baths'] = df['full_baths'].fillna(0)
            else:
                df['baths'] = 0
            
            # Apply filters (only for 'properties' table usually, but good for rentals too)
            if args.min_price:
                df = df[df['list_price'] >= args.min_price]
            if args.max_price:
                df = df[df['list_price'] <= args.max_price]
            if args.beds:
                df = df[df['beds'] >= args.beds]
            if args.baths:
                df = df[df['baths'] >= args.baths]
                
            # Limit results
            if args.limit and args.limit > 0:
                df = df.head(args.limit)
                
            count = len(df)
            total_found += count
            
            if count == 0:
                print(f"No {l_type} properties matched filters.", file=sys.stderr)
                continue

            # Insert into Supabase
            user_id = DEFAULT_USER_ID
            
            for index, row in df.iterrows():
                if target_table == 'properties':
                    data = process_listing(row, user_id)
                    conflict_target = "id" # We check existence manually below
                else:
                    data = process_rental(row)
                    conflict_target = "address, listing_date"

                if data:
                    # Validate address
                    if 'address' not in data or not data['address']:
                        continue

                    print(f"Processing ({l_type}): {data['address']}", file=sys.stderr)
                    try:
                        if target_table == 'properties':
                            # Check existence manually for properties to handle updates
                            existing = supabase.table("properties").select("id").eq("address", data["address"]).execute()
                            if existing.data:
                                print(f"Updating: {data['address']}", file=sys.stderr)
                                prop_id = existing.data[0]['id']
                                data_to_update = data.copy()
                                data_to_update.pop('user_id', None) 
                                data_to_update['updated_at'] = "now()"
                                supabase.table("properties").update(data_to_update).eq("id", prop_id).execute()
                                total_inserted += 1
                            else:
                                print(f"Inserting: {data['address']}", file=sys.stderr)
                                supabase.table("properties").insert(data).execute()
                                total_inserted += 1
                        else:
                            # For rentals, we use upsert on address+date
                            supabase.table("rental_listings").upsert(data, on_conflict=conflict_target).execute()
                            total_inserted += 1
                            
                    except Exception as e:
                        print(f"INSERT ERROR: {data['address']} - {str(e)}", file=sys.stderr)
                        all_errors.append(f"Error inserting {data['address']}: {str(e)}")

        print(json.dumps({
            "message": "Scrape complete", 
            "found": total_found, 
            "inserted": total_inserted,
            "errors": all_errors[:5]
        }))

    except Exception as e:
        print(f"CRITICAL ERROR: {str(e)}", file=sys.stderr)
        print(json.dumps({"error": str(e), "found": 0, "inserted": 0})) # Fallback JSON
        sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Real Estate Scraper")
    parser.add_argument("--location", required=True, help="Zip code or City, State")
    parser.add_argument("--min_price", type=float, help="Minimum price")
    parser.add_argument("--max_price", type=float, help="Maximum price")
    parser.add_argument("--beds", type=int, help="Minimum bedrooms")
    parser.add_argument("--baths", type=float, help="Minimum bathrooms")
    parser.add_argument("--limit", type=int, default=10, help="Max results to process. -1 for unlimited.")
    
    parser.add_argument("--site_name", help="Comma-separated list of sites (realtor.com, zillow, redfin)")
    parser.add_argument("--listing_type", default="for_sale", help="Listing type (for_sale, for_rent, sold)")
    parser.add_argument("--past_days", type=int, default=30, help="Days of history to fetch")
    
    args = parser.parse_args()
    run_scraper(args)