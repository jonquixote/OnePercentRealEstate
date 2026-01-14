import os
import requests
import time
import json
from datetime import datetime
from supabase import create_client, Client
from dotenv import load_dotenv

# Load env from parent directory
env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../.env.local')
load_dotenv(dotenv_path=env_path)

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY")
HUD_API_TOKEN = os.getenv("HUD_API_TOKEN")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env")
    exit(1)

if not HUD_API_TOKEN:
    print("Warning: HUD_API_TOKEN not set. Live data fetch will fail.")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
HUD_BASE_URL = "https://www.huduser.gov/hudapi/public/fmr"

# Global Caches
_state_cache = None
_county_cache = {} # Key: State Code (OH), Value: List of counties
_fips_processed = set() 

# Static Map for MVP Markets
CITY_COUNTY_MAP = {
    "Cleveland, OH": "Cuyahoga",
    "Indianapolis, IN": "Marion",
    "El Paso, TX": "El Paso",
    "Columbia, SC": "Richland",
    "Tuscaloosa, AL": "Tuscaloosa",
    "Toledo, OH": "Lucas",
    "Huntsville, AL": "Madison",
    "Tampa, FL": "Hillsborough",
    "Kansas City, MO": "Jackson",
    "Ocala, FL": "Marion",
    "Memphis, TN": "Shelby",
    "Birmingham, AL": "Jefferson",
    "Charlotte, NC": "Mecklenburg",
    "Columbus, OH": "Franklin"
}

def get_properties_info():
    """Fetches zip, city, state from properties table."""
    try:
        response = supabase.table("properties").select("raw_data").execute()
        props = []
        for row in response.data:
            rd = row.get('raw_data', {})
            if rd and 'zip_code' in rd:
                z = str(rd['zip_code']).split('-')[0].split('.')[0].strip()
                if len(z) == 5:
                    props.append({
                        "zip": z,
                        "city": rd.get('city'),
                        "state": rd.get('state')
                    })
        return props
    except Exception as e:
        print(f"Error fetching properties: {e}")
        return []

def get_hud_headers():
    return {"Authorization": f"Bearer {HUD_API_TOKEN}"}

def get_state_id(state_code):
    global _state_cache
    if _state_cache is None:
        try:
            resp = requests.get(f"{HUD_BASE_URL}/listStates", headers=get_hud_headers())
            if resp.status_code == 200:
                _state_cache = resp.json()
            else:
                print(f"Failed to list states: {resp.status_code}")
                return None
        except Exception as e:
            print(f"Error fetching states: {e}")
            return None
    return state_code

def get_county_fips(state_code, county_name):
    """Finds FIPS code for a county within a state."""
    global _county_cache
    
    if state_code not in _county_cache:
        try:
             resp = requests.get(f"{HUD_BASE_URL}/listCounties/{state_code}", headers=get_hud_headers())
             if resp.status_code == 200:
                 _county_cache[state_code] = resp.json()
             else:
                 print(f"Failed to list counties for {state_code}: {resp.status_code}")
                 return None
        except Exception as e:
            print(f"Error fetching counties for {state_code}: {e}")
            return None

    counties = _county_cache.get(state_code, [])
    target_name = county_name.lower().replace(" county", "").strip()
    
    for c in counties:
        c_name = c['county_name'].lower().replace(" county", "").strip()
        if c_name == target_name:
            return c['fips_code']
    
    return None

def fetch_county_safmr(fips_code):
    """Fetches SAFMR data for all zips in a county FIPS."""
    year = 2025 
    url = f"{HUD_BASE_URL}/data/{fips_code}?year={year}"
    try:
        print(f"Fetching HUD Data for FIPS {fips_code}...")
        resp = requests.get(url, headers=get_hud_headers())
        if resp.status_code == 200:
            return resp.json()
        elif resp.status_code == 400:
            print(f"400 Error for {fips_code}. Response: {resp.text}")
        else:
            print(f"Error {resp.status_code} fetching FIPS {fips_code}")
        return None
    except Exception as e:
         print(f"Exception fetching FIPS {fips_code}: {e}")
         return None

def upsert_safmr_data(api_response):
    """Upserts all zips found in the API response."""
    results = []
    
    # Check for 'basicdata' key in 'data'
    if isinstance(api_response, dict):
        if 'data' in api_response and isinstance(api_response['data'], dict):
             results = api_response['data'].get('basicdata', [])
        elif 'basicdata' in api_response:
             results = api_response['basicdata']
    
    if not results:
        print("Warning: No 'basicdata' found in API response.")
    
    count = 0
    for item in results:
        zip_code = item.get('zip_code')
        if not zip_code: continue
        
        # Transform to our schema
        # We want: 0br, 1br, 2br...
        safmr_entry = {
            "0br": item.get('Efficiency'),
            "1br": item.get('One-Bedroom'),
            "2br": item.get('Two-Bedroom'),
            "3br": item.get('Three-Bedroom'),
            "4br": item.get('Four-Bedroom')
        }
        
        # Check if valid dict (has 2br is good proxy)
        if safmr_entry['2br'] is None: continue
        
        try:
             supabase.table("market_benchmarks").upsert({
                 "zip_code": zip_code,
                 "safmr_data": safmr_entry,
                 "last_updated": datetime.now().isoformat()
             }).execute()
             count += 1
        except Exception as e:
            print(f"Error upserting {zip_code}: {e}")

    print(f"Upserted {count} benchmarks from FIPS query.")

def run_hud_sync():
    print("Starting Live HUD Sync (Static Map)...")
    
    # 1. Get Property Info
    props = get_properties_info()
    print(f"Found {len(props)} properties to check.")
    
    unique_zips = set()
    
    # 2. Iterate
    for p in props:
        zip_code = p['zip']
        city = p['city']
        state = p['state']
        
        if not city or not state:
            continue
            
        key = f"{city}, {state}" 
        county_name = None
        
        if key in CITY_COUNTY_MAP:
            county_name = CITY_COUNTY_MAP[key]
        else:
             for k, v in CITY_COUNTY_MAP.items():
                 if k.lower() == key.lower():
                     county_name = v
                     break
        
        if not county_name:
             continue

        unique_zips.add(zip_code)
        
        try:
            fips = get_county_fips(state, county_name)
            if fips:
                if fips in _fips_processed:
                    continue 

                api_data = fetch_county_safmr(fips)
                if api_data:
                    upsert_safmr_data(api_data)
                    _fips_processed.add(fips)
                    time.sleep(0.5)
            else:
                print(f"FIPS not found for {county_name}, {state}")
                
        except Exception as e:
            print(f"Error processing {city}, {state}: {e}")

    print("Live Sync Complete.")

if __name__ == "__main__":
    run_hud_sync()
