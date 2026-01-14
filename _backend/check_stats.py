import os
import json
import urllib.request
from dotenv import load_dotenv

load_dotenv()
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json"
}

def check_stats():
    url = f"{SUPABASE_URL}/rest/v1/properties?select=address,raw_data&limit=5&order=created_at.desc"
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read().decode())
        for prop in data:
            stats = prop.get('raw_data', {}).get('neighborhood_stats', {})
            district = stats.get('census', {}).get('school_district', {})
            print(f"{prop['address']}: District={district.get('name')}, Pop={district.get('population')}")

if __name__ == "__main__":
    check_stats()
