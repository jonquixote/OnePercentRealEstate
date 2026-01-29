import os
import requests
import time
import json
import psycopg2
from psycopg2.extras import Json
from datetime import datetime
from dotenv import load_dotenv

# Load env from parent directory
env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../.env.local')
load_dotenv(dotenv_path=env_path)

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    # Fallback to backend .env if .env.local not found/set
    backend_env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    load_dotenv(dotenv_path=backend_env_path)
    DATABASE_URL = os.getenv("DATABASE_URL")

HUD_API_TOKEN = os.getenv("HUD_API_TOKEN")

if not DATABASE_URL:
    print("Error: DATABASE_URL must be set in .env.local or .env")
    exit(1)

if not HUD_API_TOKEN:
    print("Warning: HUD_API_TOKEN not set. Live data fetch will fail.")

HUD_BASE_URL = "https://www.huduser.gov/hudapi/public/fmr"

# Global Caches
_state_cache = None
_county_cache = {} # Key: State Code (OH), Value: List of counties
_fips_processed = set() 

# Static Map removed - using dynamic county from raw_data

def get_db_connection():
    try:
        conn = psycopg2.connect(DATABASE_URL)
        return conn
    except Exception as e:
        print(f"Error connecting to database: {e}")
        return None

def get_properties_info():
    """Fetches unique zip, city, state, AND county from listings."""
    conn = get_db_connection()
    if not conn:
        return []
    
    try:
        cur = conn.cursor()
        print("Fetching unique markets from database...")
        # Optimize: Let Postgres extract unique locations including COUNTY
        cur.execute("""
            SELECT DISTINCT 
                raw_data->>'zip_code', 
                raw_data->>'city', 
                raw_data->>'state',
                raw_data->>'county'
            FROM listings
            WHERE raw_data->>'zip_code' IS NOT NULL
              AND raw_data->>'county' IS NOT NULL
        """)
        rows = cur.fetchall()
        
        props = []
        for row in rows:
            zip_code, city, state, county = row
            if zip_code and county:
                # Clean zip code (handle 12345-6789 or 12345.0)
                z = str(zip_code).split('-')[0].split('.')[0].strip()
                if len(z) == 5:
                    props.append({
                        "zip": z,
                        "city": city,
                        "state": state,
                        "county": county
                    })
        
        print(f"Identified {len(props)} unique markets (zip+county).")
        cur.close()
        return props
    except Exception as e:
        print(f"Error fetching properties: {e}")
        return []
    finally:
        conn.close()

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
        return # Exit early if empty

    # Normalize to list if necessary
    if isinstance(results, dict):
        results = [results]
    elif not isinstance(results, list):
        print(f"Warning: 'results' is {type(results)}, expected list or dict. Content: {results}")
        return

    conn = get_db_connection()
    if not conn:
        print("Skipping upsert due to DB connection failure")
        return

    count = 0
    try:
        cur = conn.cursor()
        
        for item in results:
            if not isinstance(item, dict):
                 # print(f"Skipping invalid item: {item} (type: {type(item)})")
                 continue

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
                # Use PostgreSQL UPSERT
                query = """
                    INSERT INTO market_benchmarks (zip_code, safmr_data, last_updated)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (zip_code) DO UPDATE SET
                        safmr_data = EXCLUDED.safmr_data,
                        last_updated = EXCLUDED.last_updated;
                """
                cur.execute(query, (zip_code, Json(safmr_entry), datetime.now().isoformat()))
                count += 1
            except Exception as e:
                print(f"Error upserting {zip_code}: {e}")
                conn.rollback() # Rollback usage error for this item

        conn.commit()
        cur.close()
    except Exception as e:
        print(f"Batch upsert error: {e}")
    finally:
        conn.close()

    print(f"Upserted {count} benchmarks from FIPS query.")

def run_hud_sync():
    print("Starting Live HUD Sync (Dynamic Coverage)...")
    
    # 1. Get Property Info
    props = get_properties_info()
    if not props:
        print("No properties found to sync.")
        return

    # 2. Identify unique counties to fetch
    # structure: (state, county_name)
    target_counties = set()
    
    for p in props:
        state = p.get('state')
        county = p.get('county')
        if state and county:
            target_counties.add((state, county))
    
    print(f"Found {len(target_counties)} unique counties covering {len(props)} zip codes.")
    
    # 3. Fetch data for each county
    for state, county_name in target_counties:
        try:
            # Get FIPS
            fips = get_county_fips(state, county_name)
            if not fips:
                print(f"FIPS not found for {county_name}, {state}")
                continue
                
            if fips in _fips_processed:
                continue 

            # Fetch SAFMR
            api_data = fetch_county_safmr(fips)
            if api_data:
                upsert_safmr_data(api_data)
                _fips_processed.add(fips)
                
            time.sleep(2.0) # Increased delay to avoid 429 Rate Limit errors

        except Exception as e:
            print(f"Error processing {county_name}, {state}: {e}")

    print("Live Sync Complete.")

if __name__ == "__main__":
    run_hud_sync()
