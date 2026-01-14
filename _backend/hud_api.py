import os
import requests
import pandas as pd
from supabase import create_client, Client
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
HUD_API_TOKEN = os.getenv("HUD_API_TOKEN")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env")
    exit(1)

if not HUD_API_TOKEN:
    print("Warning: HUD_API_TOKEN not set. HUD data fetch will fail.")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# HUD API Base URL
HUD_BASE_URL = "https://www.huduser.gov/hudapi/public/fmr"

def fetch_safmr_data(state_code, county_code):
    """
    Fetches SAFMR data for a specific county.
    Note: HUD API structure varies. This is a simplified example assuming we can get data by county.
    Real implementation might need to iterate or use a different endpoint.
    """
    if not HUD_API_TOKEN:
        return None

    headers = {"Authorization": f"Bearer {HUD_API_TOKEN}"}
    
    # Example endpoint - check HUD documentation for exact path for SAFMR
    # Usually it's /data/{entityid} or similar. 
    # For MVP, let's assume we have a CSV or we use a known endpoint.
    # Let's try to fetch data.
    
    print(f"Fetching HUD data for {state_code} - {county_code}...")
    
    # Placeholder for actual API call
    # response = requests.get(f"{HUD_BASE_URL}/data/{state_code}/{county_code}", headers=headers)
    # if response.status_code == 200:
    #     return response.json()
    
    return None

def update_market_benchmarks(zip_code, safmr_data):
    """
    Updates the market_benchmarks table with SAFMR data.
    """
    try:
        data = {
            "zip_code": zip_code,
            "safmr_data": safmr_data, # JSONB column
            # We can also calculate an avg_rent_sqft if we have sqft data, but SAFMR is total rent.
            # We might leave avg_rent_sqft null or estimate it.
        }
        
        # Upsert
        supabase.table("market_benchmarks").upsert(data).execute()
        print(f"Updated benchmark for {zip_code}")
    except Exception as e:
        print(f"Error updating benchmark for {zip_code}: {e}")

def run_hud_sync():
    print("Starting HUD SAFMR Sync...")
    
    # For the MVP/Zero-Capital approach without a valid HUD Token immediately,
    # we can seed with some static data for our target zip codes.
    
    # Example Cleveland Zip Codes
    static_data = {
        "44109": {"0br": 700, "1br": 800, "2br": 950, "3br": 1200, "4br": 1400},
        "44111": {"0br": 750, "1br": 850, "2br": 1000, "3br": 1250, "4br": 1450},
        "44135": {"0br": 720, "1br": 820, "2br": 980, "3br": 1220, "4br": 1420},
        "44104": {"0br": 650, "1br": 750, "2br": 900, "3br": 1100, "4br": 1300},
        "44105": {"0br": 680, "1br": 780, "2br": 920, "3br": 1150, "4br": 1350},
        "44108": {"0br": 660, "1br": 760, "2br": 910, "3br": 1120, "4br": 1320},
        "44110": {"0br": 670, "1br": 770, "2br": 930, "3br": 1140, "4br": 1340},
        "44113": {"0br": 900, "1br": 1100, "2br": 1400, "3br": 1700, "4br": 2000}, # Tremont/Ohio City - Higher
        "44102": {"0br": 800, "1br": 950, "2br": 1150, "3br": 1400, "4br": 1600},
        "44128": {"0br": 750, "1br": 850, "2br": 1050, "3br": 1300, "4br": 1500},
        "44134": {"0br": 800, "1br": 900, "2br": 1100, "3br": 1350, "4br": 1550},
        "44144": {"0br": 780, "1br": 880, "2br": 1080, "3br": 1320, "4br": 1520},
        "44120": {"0br": 700, "1br": 800, "2br": 1000, "3br": 1250, "4br": 1450},
        "44130": {"0br": 850, "1br": 950, "2br": 1150, "3br": 1450, "4br": 1650},
        "44121": {"0br": 820, "1br": 920, "2br": 1120, "3br": 1400, "4br": 1600},
        "44129": {"0br": 810, "1br": 910, "2br": 1110, "3br": 1380, "4br": 1580},
        "44119": {"0br": 710, "1br": 810, "2br": 960, "3br": 1180, "4br": 1380},
        "44112": {"0br": 640, "1br": 740, "2br": 890, "3br": 1090, "4br": 1290},
        "44126": {"0br": 950, "1br": 1050, "2br": 1250, "3br": 1550, "4br": 1750},
        "44143": {"0br": 900, "1br": 1000, "2br": 1200, "3br": 1500, "4br": 1700},
        "44124": {"0br": 920, "1br": 1020, "2br": 1220, "3br": 1520, "4br": 1720},
        "44122": {"0br": 980, "1br": 1100, "2br": 1350, "3br": 1650, "4br": 1900},
        "46220": {"0br": 950, "1br": 1050, "2br": 1250, "3br": 1550, "4br": 1750}, # Indianapolis
        "46204": {"0br": 1100, "1br": 1300, "2br": 1600, "3br": 2000, "4br": 2400}, # Indianapolis Downtown
    }
    
    for zip_code, rents in static_data.items():
        update_market_benchmarks(zip_code, rents)
        
    print("HUD Sync Complete (Static Seed).")

if __name__ == "__main__":
    run_hud_sync()
