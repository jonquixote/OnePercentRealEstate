import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: Missing Supabase credentials")
    exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

try:
    # Count properties
    prop_count = supabase.table("properties").select("*", count="exact", head=True).execute().count
    
    # Count rental listings
    rent_count = supabase.table("rental_listings").select("*", count="exact", head=True).execute().count
    
    print(f"Total Properties: {prop_count}")
    print(f"Total Rental Listings: {rent_count}")
except Exception as e:
    print(f"Error counting: {e}")
