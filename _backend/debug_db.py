import os
import json
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Missing credentials")
    exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def list_properties():
    try:
        response = supabase.table("properties").select("address, listing_price").execute()
        properties = response.data
        print(f"Total Properties in DB: {len(properties)}")
        for p in properties:
            print(f"- {p['address']} (${p['listing_price']})")
            
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    list_properties()
