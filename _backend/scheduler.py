import os
import time
import sys
import subprocess
import json
from datetime import datetime, timedelta
from supabase import create_client, Client
from dotenv import load_dotenv

# Load env from parent directory
# Load env from parent directory
env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../.env.local')
load_dotenv(dotenv_path=env_path)

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: Missing Supabase credentials")
    exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def get_due_targets():
    """
    Fetches targets that are active and due for scraping.
    """
    try:
        # We want targets where last_scraped is older than frequency_hours OR last_scraped is null.
        # Supabase-py filtering is a bit limited for complex OR logic in one query sometimes.
        # We'll fetch active targets and filter in python for now to keep it simple, 
        # or use a raw query if we had a stored procedure.
        # Let's fetch all active targets and filter client-side for simplicity.
        
        response = supabase.table("market_targets").select("*").eq("is_active", True).order("priority").execute()
        targets = response.data
        due = []
        now = datetime.utcnow()
        
        for t in targets:
            last_scraped_str = t.get('last_scraped')
            freq = t.get('frequency_hours', 24)
            
            if not last_scraped_str:
                due.append(t)
                continue
                
            # Parse ISO timestamp
            # Supabase returns ISO strings usually ending in +00:00 or Z
            try:
                last_scraped = datetime.fromisoformat(last_scraped_str.replace('Z', '+00:00'))
                # make now timezone aware if last_scraped is
                if last_scraped.tzinfo:
                    diff = now.astimezone(last_scraped.tzinfo) - last_scraped
                else:
                    diff = now - last_scraped
                
                if diff > timedelta(hours=freq):
                    due.append(t)
            except Exception as e:
                print(f"Error parsing date for {t['location']}: {e}")
                due.append(t) # Retry if date error
                
        return due
    except Exception as e:
        print(f"Error fetching targets: {e}")
        return []

def run_scraper_for_target(target):
    location = target['location']
    l_type = target.get('listing_type', 'for_sale')
    
    print(f"Starting job: {location} ({l_type})...")
    
    # Run scraper as subprocess
    cmd = [
        sys.executable, 
        "scraper.py", 
        "--location", location, 
        "--listing_type", l_type,
        "--limit", "100" # Broad scrape
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        # Parse output to verify success? Scraper prints JSON at end.
        print(result.stderr) # Prints progress
        
        # Update last_scraped
        supabase.table("market_targets").update({
            "last_scraped": datetime.utcnow().isoformat()
        }).eq("id", target['id']).execute()
        
        print(f"Completed job: {location}")
        
    except subprocess.CalledProcessError as e:
        print(f"Job failed for {location}: {e.stderr}")

def main():
    print("Scheduler Service Started.")
    while True:
        targets = get_due_targets()
        
        if not targets:
            print("No active targets due. Sleeping for 1 hour...")
            time.sleep(3600)
            continue
            
        print(f"Found {len(targets)} due targets.")
        
        for target in targets:
            run_scraper_for_target(target)
            
        print("All due jobs completed. Sleeping for 1 hour...")
        time.sleep(3600)

if __name__ == "__main__":
    main()
