import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
DEFAULT_USER_ID = os.getenv("DEFAULT_USER_ID")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def create_profile():
    print(f"Attempting to create profile for {DEFAULT_USER_ID}...")
    try:
        data = {"id": DEFAULT_USER_ID, "subscription_tier": "free"}
        supabase.table("profiles").insert(data).execute()
        print("Profile created successfully.")
    except Exception as e:
        print(f"Error creating profile: {e}")

if __name__ == "__main__":
    create_profile()
