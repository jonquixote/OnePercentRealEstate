import os
import json
import urllib.request
import urllib.parse
import time
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: Missing Supabase credentials")
    exit(1)

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation"
}

def make_request(url, params=None, method='GET', data=None, headers=None, retries=3):
    original_url = url
    try:
        if params:
            query_string = urllib.parse.urlencode(params)
            if '?' in url:
                url = f"{url}&{query_string}"
            else:
                url = f"{url}?{query_string}"
        
        req = urllib.request.Request(url, method=method)
        
        # Default User-Agent if not provided
        if not headers or 'User-Agent' not in headers:
            req.add_header('User-Agent', 'OnePercentRealEstate/1.0 (johnny@example.com)')
        
        if headers:
            for k, v in headers.items():
                req.add_header(k, v)
        
        if data:
            req.data = json.dumps(data).encode('utf-8')
            if not headers:
                req.add_header('Content-Type', 'application/json')
        
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                if response.status >= 200 and response.status < 300:
                    return json.loads(response.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            if e.code in [429, 504, 502, 503] and retries > 0:
                print(f"Rate limited or timeout ({e.code}), retrying in 5s...")
                time.sleep(5)
                return make_request(original_url, params, method, data, headers, retries - 1)
            else:
                print(f"HTTP Error ({url}): {e.code} {e.reason}")
                
    except Exception as e:
        print(f"Request Error ({url}): {e}")
    return None

def get_osm_amenities(lat, lon, radius=1000):
    # Use HTTPS
    overpass_url = "https://overpass-api.de/api/interpreter"
    overpass_query = f"""
    [out:json][timeout:25];
    (
      node["amenity"](around:{radius},{lat},{lon});
      way["amenity"](around:{radius},{lat},{lon});
      relation["amenity"](around:{radius},{lat},{lon});
    );
    out center;
    """
    return make_request(overpass_url, {'data': overpass_query})

def get_unemployment_data(state_fips, county_fips):
    """
    Fetches unemployment rate from BLS Public API.
    Series ID Format: LAUCN + StateFIPS + CountyFIPS + 0000000003
    """
    try:
        series_id = f"LAUCN{state_fips}{county_fips}0000000003"
        url = "https://api.bls.gov/publicAPI/v2/timeseries/data/"
        payload = {
            "seriesid": [series_id],
            "startyear": "2023",
            "endyear": "2023" 
        }
        
        # BLS requires Content-Type header
        headers = {'Content-Type': 'application/json'}
        data = make_request(url, method='POST', data=payload, headers=headers)
        
        if data and data.get('status') == 'REQUEST_SUCCEEDED':
            series = data.get('Results', {}).get('series', [])
            if series:
                data_points = series[0].get('data', [])
                if data_points:
                    # Get the latest month available
                    latest = data_points[0]
                    return {
                        "rate": latest.get('value'),
                        "period": latest.get('periodName') + " " + latest.get('year')
                    }
    except Exception as e:
        print(f"BLS Error: {e}")
    return None

def get_census_data(lat, lon):
    try:
        geo_url = "https://geocoding.geo.census.gov/geocoder/geographies/coordinates"
        params = {
            'x': lon,
            'y': lat,
            'benchmark': 'Public_AR_Current',
            'vintage': 'Current_Current',
            'layers': 'all',
            'format': 'json'
        }
        geo_data = make_request(geo_url, params)
        
        state_fips = None
        county_fips = None
        
        if geo_data:
            geographies = geo_data.get('result', {}).get('geographies', {})
            print(f"Geographies keys: {list(geographies.keys())}") # Debug
            counties = geographies.get('Counties', [])
            school_districts = geographies.get('Unified School Districts', []) # Try this key
            
            if counties:
                state_fips = counties[0].get('STATE')
                county_fips = counties[0].get('COUNTY')
        
        if not state_fips or not county_fips:
            print("Could not determine FIPS codes from coordinates.")
            return None

        # SAIPE API
        saipe_url = "https://api.census.gov/data/timeseries/poverty/saipe"
        # SAEPOVALL_PT = Total Population in Poverty
        # SAEPOVRTALL_PT = Poverty Rate All Ages
        # SAEMHI_PT = Median Household Income
        # SAEPOP_PT = Total Population (available in some datasets, let's try)
        saipe_params = {
            'get': 'SAEPOVALL_PT,SAEPOVRTALL_PT,SAEMHI_PT,NAME', # Removed SAEPOP_PT for now as it might not be in this dataset, using derived or just these.
            # actually, let's try adding SAEPOP_PT if it exists, or we can calculate it.
            # Wait, search said "total population variable... is not explicitly listed... for states and counties".
            # But we can try to fetch it or just use the poverty count and rate.
            # Let's stick to what we know works first, but user asked for "total county population".
            # Let's try to fetch SAEPOP_PT, if it fails we handle it.
            # Actually, let's look at the variable list again.
            # Re-reading search: "Total Population: The variable for total population is SAEPOVALL_PT" -> NO, that's poverty count.
            # Let's try to infer population from Poverty Count / Rate.
            'get': 'SAEPOVALL_PT,SAEPOVRTALL_PT,SAEMHI_PT,NAME',
            'for': f'county:{county_fips}',
            'in': f'state:{state_fips}',
            'time': '2023' # Try 2023
        }
        
        data = make_request(saipe_url, saipe_params)
        census_result = {}
        
        if data and len(data) > 1:
            headers = data[0]
            values = data[1]
            result = dict(zip(headers, values))
            
            # Calculate Total Population if possible
            poverty_count = float(result.get('SAEPOVALL_PT', 0))
            poverty_rate = float(result.get('SAEPOVRTALL_PT', 0))
            total_pop = 0
            if poverty_rate > 0:
                total_pop = int(poverty_count / (poverty_rate / 100))
            
            census_result = {
                "poverty_count": result.get('SAEPOVALL_PT'), # Total in Poverty
                "poverty_rate": result.get('SAEPOVRTALL_PT'),
                "median_income": result.get('SAEMHI_PT'),
                "population": total_pop, # Derived
                "area_name": result.get('NAME'),
                "year": '2023'
            }
        
        # Fetch Unemployment
        unemployment = get_unemployment_data(state_fips, county_fips)
        if unemployment:
            census_result['unemployment'] = unemployment
            
        # Fetch School District Data (NCES/SAIPE via Urban Institute)
        if school_districts:
            district_id = school_districts[0].get('GEOID') # e.g. 3904378
            district_name = school_districts[0].get('NAME')
            
            # Urban Institute Education Data Portal API
            # https://educationdata.urban.org/api/v1/school-districts/saipe/{year}/?leaid={id}
            # Uses NCES LEA ID which matches Census GEOID (State+District)
            
            # Try 2022, fallback to 2021 if needed
            ui_url = "https://educationdata.urban.org/api/v1/school-districts/saipe/2022/"
            ui_params = {'leaid': district_id}
            
            ui_data = make_request(ui_url, ui_params)
            
            # If 2022 fails or empty, try 2021
            if not ui_data or not ui_data.get('results'):
                 ui_url = "https://educationdata.urban.org/api/v1/school-districts/saipe/2021/"
                 ui_data = make_request(ui_url, ui_params)

            if ui_data and ui_data.get('results'):
                result = ui_data['results'][0]
                
                # Fields:
                # est_population_total: Total Population
                # est_population_5_17_poverty: Ages 5-17 in Poverty
                # est_population_5_17_poverty_pct: Poverty Rate Ages 5-17
                
                pop_total = result.get('est_population_total')
                pop_5_17_pov = result.get('est_population_5_17_poverty')
                pov_rate = result.get('est_population_5_17_poverty_pct')
                
                if pov_rate:
                    pov_rate = round(float(pov_rate) * 100, 1) # API returns 0.25 for 25%? Or 25?
                    # Let's assume it returns percentage or decimal. 
                    # Usually 'pct' implies percentage (0-100) or decimal (0-1). 
                    # If it's > 1 it's likely percentage. If < 1 it's decimal.
                    # Wait, let's check the value if possible.
                    # But safe to assume if it's small float, multiply by 100.
                    # Actually, let's just use the value as is if > 1, or * 100 if < 1.
                    # But simpler: check if it's decimal.
                    if pov_rate < 1:
                         pov_rate = round(pov_rate * 100, 1)
                    else:
                         pov_rate = round(pov_rate, 1)
                
                census_result['school_district'] = {
                    "name": district_name,
                    "population": pop_total,
                    "poverty_count_5_17": pop_5_17_pov,
                    "poverty_rate_5_17": pov_rate
                }

        return census_result
                
    except Exception as e:
        print(f"Census Error: {e}")
    return None

def enrich_properties():
    # 1. Fetch properties via REST
    url = f"{SUPABASE_URL}/rest/v1/properties"
    params = {
        "select": "*",
        "order": "created_at.desc",
        "limit": "100"
    }
    
    properties = make_request(url, params, headers=HEADERS)
    
    if not properties:
        print("No properties found or error fetching.")
        return

    print(f"Enriching {len(properties)} properties...")

    for prop in properties:
        raw = prop.get('raw_data', {})
        if not raw: raw = {} 
        
        lat = raw.get('latitude') or raw.get('lat')
        lon = raw.get('longitude') or raw.get('lon') 
        
        if not lat or not lon:
            print(f"Skipping {prop.get('address')}: No coordinates found.")
            continue

        print(f"Processing {prop.get('address')} ({lat}, {lon})...")
        
        # Fetch Data
        osm_data = None
        census_data = None
        
        osm_resp = get_osm_amenities(lat, lon)
        if osm_resp:
            elements = osm_resp.get('elements', [])
            counts = {}
            for el in elements:
                amenity = el.get('tags', {}).get('amenity', 'other')
                counts[amenity] = counts.get(amenity, 0) + 1
            osm_data = {
                "total_count": len(elements),
                "counts": counts,
                "radius_meters": 1000
            }

        census_data = get_census_data(lat, lon)
        
        # Update Raw Data
        if osm_data or census_data:
            if 'neighborhood_stats' not in raw:
                raw['neighborhood_stats'] = {}
            
            if osm_data:
                raw['neighborhood_stats']['osm'] = osm_data
            if census_data:
                raw['neighborhood_stats']['census'] = census_data
            
            # Save back to DB via REST
            update_url = f"{SUPABASE_URL}/rest/v1/properties?id=eq.{prop['id']}"
            make_request(update_url, method='PATCH', data={"raw_data": raw}, headers=HEADERS)
            print(f"Updated {prop.get('address')}")
            
        time.sleep(2)

if __name__ == "__main__":
    enrich_properties()
