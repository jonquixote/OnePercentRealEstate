import os
import time
import sys
import subprocess
import json
from datetime import datetime, timedelta
import psycopg2
from dotenv import load_dotenv

# Load env from parent directory
env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../.env.local')
load_dotenv(dotenv_path=env_path)

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    # Fallback
    DB_USER = os.getenv("DB_USER", "postgres")
    DB_PASS = os.getenv("DB_PASS", "root_password_change_me_please")
    DB_HOST = os.getenv("DB_HOST", "infrastructure-postgres-1")
    DB_PORT = os.getenv("DB_PORT", "5432")
    DB_NAME = os.getenv("DB_NAME", "postgres")
    DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASS}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

def get_db_connection():
    try:
        return psycopg2.connect(DATABASE_URL)
    except Exception as e:
        print(f"DB Connect Error: {e}")
        return None

def get_due_targets():
    """
    Fetches targets that are active and due for scraping.
    """
    conn = get_db_connection()
    if not conn:
        return []
        
    try:
        cursor = conn.cursor()
        # Fetch active targets
        cursor.execute("""
            SELECT id, location, listing_type, frequency_hours, last_scraped 
            FROM market_targets 
            WHERE is_active = TRUE 
            ORDER BY priority DESC, id ASC
        """)
        rows = cursor.fetchall()
        
        due = []
        now = datetime.utcnow()
        
        for r in rows:
            tid, location, l_type, freq, last_scraped = r
            
            # Map None frequency to default 24
            if freq is None: freq = 24
            
            if not last_scraped:
                due.append({'id': tid, 'location': location, 'listing_type': l_type})
                continue
                
            # Check time
            # last_scraped from PG is usually datetime object
            if isinstance(last_scraped, datetime):
                # Ensure UTC
                if last_scraped.tzinfo:
                    diff = now.replace(tzinfo=None) - last_scraped.replace(tzinfo=None) # Simple compare
                else:
                    diff = now - last_scraped
                    
                if diff > timedelta(hours=freq):
                    due.append({'id': tid, 'location': location, 'listing_type': l_type})
            else:
                 # fallback if string? probably not with psycopg2
                 due.append({'id': tid, 'location': location, 'listing_type': l_type})

        return due
        
    except Exception as e:
        print(f"Error fetching targets: {e}")
        return []
    finally:
        conn.close()

def run_scraper_for_target(target):
    location = target['location']
    l_type = target.get('listing_type', 'for_sale') or 'for_sale'
    
    print(f"Starting job: {location} ({l_type})...")
    
    # Run scraper as subprocess
    # Use the same python executable
    cmd = [
        sys.executable, 
        "_backend/scraper.py", # Path relative to root if run from root, or absolute
        "--location", location, 
        "--listing_type", l_type,
        "--limit", "100" 
    ]
    
    # Adjust path if running from inside _backend
    if os.getcwd().endswith("_backend"):
        cmd[1] = "scraper.py"

    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        # Check output for errors
        if result.returncode != 0:
            print(f"Scraper failed for {location}: {result.stderr}")
            return

        print(f"Scraper finished for {location}.")
        # print(result.stderr) # Optional debug

        # Update last_scraped
        conn = get_db_connection()
        if conn:
            try:
                cur = conn.cursor()
                cur.execute("""
                    UPDATE market_targets 
                    SET last_scraped = NOW() 
                    WHERE id = %s
                """, (target['id'],))
                conn.commit()
                print(f"Updated timestamp for {location}")
            except Exception as e:
                print(f"Failed to update timestamp: {e}")
            finally:
                conn.close()
        
    except Exception as e:
        print(f"Job execution failed for {location}: {e}")

def main():
    print("Scheduler Service Started (PostgreSQL native).")
    while True:
        targets = get_due_targets()
        
        if not targets:
            print("No active targets due. Sleeping for 1 hour...")
            time.sleep(3600)
            continue
            
        print(f"Found {len(targets)} due targets.")
        
        for target in targets:
            run_scraper_for_target(target)
            # Sleep briefly between targets to be nice
            time.sleep(5)
            
        print("All due jobs completed. Sleeping for 1 hour...")
        time.sleep(3600)

if __name__ == "__main__":
    main()
