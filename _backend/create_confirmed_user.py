import os
import sys
from supabase import create_client, Client
from dotenv import load_dotenv

# Load from backend/.env
load_dotenv('backend/.env')

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not url or not key:
    print("Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend/.env")
    sys.exit(1)

supabase: Client = create_client(url, key)

email = "admin@example.com"
password = "password123"

try:
    # Check if user exists first to avoid error
    # Admin API doesn't have a simple "get by email" that doesn't throw if missing?
    # We'll just try to create and catch error.
    
    print(f"Attempting to create user: {email}")
    
    user = supabase.auth.admin.create_user({
        "email": email,
        "password": password,
        "email_confirm": True,
        "user_metadata": {
            "full_name": "Admin User"
        }
    })
    
    print(f"User created successfully!")
    print(f"ID: {user.user.id}")
    print(f"Email: {user.user.email}")
    print(f"\nLOGIN CREDENTIALS:")
    print(f"Email: {email}")
    print(f"Password: {password}")

except Exception as e:
    print(f"Error creating user: {e}")
    # If error is "User already registered", that's fine, just tell them.
