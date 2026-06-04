import os
import json
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

try:
    resp = supabase.table("properties").select("*").limit(5).execute()
    for p in resp.data:
        print(f"Address: {p.get('address')}")
        print(f"Lat: {p.get('lat')}, Latitude: {p.get('latitude')}")
        print(f"Lon: {p.get('lon')}, Longitude: {p.get('longitude')}")
        print("-" * 20)
except Exception as e:
    print(f"Error: {e}")
