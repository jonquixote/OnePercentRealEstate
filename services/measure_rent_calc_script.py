import time
import os
import json
from dotenv import load_dotenv
from supabase import create_client, Client
from estimate_rent import estimate_rent

load_dotenv()
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def measure():
    try:
        # Hardcoded Cleveland coordinates for testing speed
        lat = 41.4993
        lon = -81.6944
        beds = 3
        baths = 1.5
        sqft = 1500
        year_built = 1950
        zip_code = "44113"

        print(f"Testing rent calc for generic Cleveland location.")
        print(f"Params: lat={lat}, lon={lon}, beds={beds}, baths={baths}, sqft={sqft}, year={year_built}")

        start_time = time.time()
        result = estimate_rent(lat, lon, beds, baths, sqft, year_built, zip_code)
        end_time = time.time()
        
        duration = end_time - start_time
        print(f" calculation took {duration:.4f} seconds")
        pass # print(json.dumps(result, indent=2)) # Don't flood output
        if result:
            print(f"Estimated Rent: {result.get('estimated_rent')}")
            print(f"Comps Used: {result.get('comps_used')}")

    except Exception as e:
        print(f"Error measuring: {e}")

if __name__ == "__main__":
    measure()
