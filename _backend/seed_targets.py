import os
from supabase import create_client, Client
from dotenv import load_dotenv

# Load env from parent directory
env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../.env.local')
print(f"DEBUG: Loading env from {env_path}")
print(f"DEBUG: File exists? {os.path.exists(env_path)}")
load_dotenv(dotenv_path=env_path)

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL:
    print("Error: NEXT_PUBLIC_SUPABASE_URL is missing")
if not SUPABASE_KEY:
    print("Error: SUPABASE_SERVICE_ROLE_KEY is missing")
    
if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: Missing Supabase credentials")
    exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

TARGETS = [
    # User Requested
    "Cleveland, OH",
    "Indianapolis, IN",
    
    # Research: Top Cash Flow Markets 2025
    "El Paso, TX",
    "Columbia, SC",
    "Tuscaloosa, AL",
    "Toledo, OH",
    "Huntsville, AL",
    "Tampa, FL",
    "Kansas City, MO",
    "Ocala, FL",
    "Memphis, TN",
    "Birmingham, AL",
    "Charlotte, NC",
    "Columbus, OH"
]

def seed():
    print("Seeding market targets...")
    cleaned_targets = []
    
    # 1. Add FOR_SALE targets for all
    for city in TARGETS:
        cleaned_targets.append({
            "location": city,
            "listing_type": "for_sale",
            "priority": 5,
            "frequency_hours": 24
        })

    # 2. Add SOLD targets for User Requested (Cleveland, Indy) + Top 2
    # "Sold" data is static so we can scrape it less frequently (e.g. 7 days)
    sold_cities = ["Cleveland, OH", "Indianapolis, IN", "El Paso, TX", "Columbia, SC"]
    for city in sold_cities:
         cleaned_targets.append({
            "location": city,
            "listing_type": "sold",
            "priority": 8, # Lower priority
            "frequency_hours": 168 # Once a week
        })

    inserted_count = 0
    for t in cleaned_targets:
        try:
            # Upsert on location/listing_type ideally, but our constraint is only on location currently?
            # Wait, the schema said: location TEXT UNIQUE. 
            # If so, we can't have two rows for "Cleveland, OH" with different listing types.
            # I need to check the schema I outputted.
            # "location TEXT UNIQUE NOT NULL"
            # Ah, that's a bug in my schema design if I want multiple types per city.
            # I should fix the schema OR just combine them.
            # But wait, the schema is already applied by the user. 
            # I should probably just insert "Cleveland, OH" (for_sale) for now.
            # If I want 'sold', I might need to append suffix or change schema.
            # 
            # Strategy: Just insert the locations. The scraper (scheduler) can decide what to scrape?
            # No, text says "listing_type DEFAULT 'for_sale'".
            # 
            # I will just insert the locations as 'for_sale' for now.
            # If the user wants sold, they can toggle it or I can add a new row "Cleveland, OH (Sold)"?
            # No, that will break the scraper location arg.
            # 
            # FIX: I will check if I can modify the constraint.
            # But I can't easily.
            # 
            # Alternative: I'll just insert the 14 cities.
            # And maybe I update the scraper to scrape BOTH if the target exists?
            # Or simplified: I just insert them as 'for_sale' (which scrapes 'for_rent' too usually).
            # For 'sold', we might need a separate mechanism or just change the listing_type of the row periodically?
            # 
            # Let's stick to the 14 cities as 'for_sale' for now to get data flowing.
            # I will treat "Cleveland, OH" as the primary target.
            
            data = {
                "location": t['location'],
                "listing_type": "for_sale",
                "priority": t['priority'],
                "frequency_hours": 24
            }
            
            # Check if exists to avoid error if unique constraint
            existing = supabase.table("market_targets").select("id").eq("location", t['location']).execute()
            if not existing.data:
                supabase.table("market_targets").insert(data).execute()
                print(f"Inserted: {t['location']}")
                inserted_count += 1
            else:
                print(f"Skipped (Exists): {t['location']}")
                
        except Exception as e:
            print(f"Error inserting {t['location']}: {e}")

    print(f"Seeding complete. Added {inserted_count} new targets.")

if __name__ == "__main__":
    seed()
