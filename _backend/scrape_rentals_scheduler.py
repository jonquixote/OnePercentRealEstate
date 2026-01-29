#!/usr/bin/env python3
"""
Automated Rental Listings Scraper Scheduler
Runs daily to build up the rental_listings dataset for ML training.
Uses HomeHarvest (free) to scrape from Realtor.com.
"""

import os
import sys
import time
import json
import psycopg2
from datetime import datetime, timedelta
from dotenv import load_dotenv

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_rental_comps import fetch_rentals

# Load environment
env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../.env.local')
load_dotenv(dotenv_path=env_path)

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    # Fallback to constructing from parts if DATABASE_URL not set
    DB_USER = os.getenv("DB_USER", "postgres")
    DB_PASS = os.getenv("DB_PASS", "root_password_change_me_please")
    DB_HOST = os.getenv("DB_HOST", "infrastructure-postgres-1")
    DB_PORT = os.getenv("DB_PORT", "5432")
    DB_NAME = os.getenv("DB_NAME", "postgres")
    DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASS}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

def get_db_connection():
    try:
        conn = psycopg2.connect(DATABASE_URL)
        return conn
    except Exception as e:
        print(f"Error connecting to database: {e}", file=sys.stderr)
        return None

# Default markets to scrape for ML training data
# These are high-volume rental markets with good data availability
DEFAULT_MARKETS = [
    # Ohio
    "Cleveland, OH",
    "Columbus, OH",
    "Toledo, OH",
    "Akron, OH",
    "Dayton, OH",
    # Indiana
    "Indianapolis, IN",
    "Fort Wayne, IN",
    # Texas
    "El Paso, TX",
    "San Antonio, TX",
    "Houston, TX",
    # Florida
    "Tampa, FL",
    "Orlando, FL",
    "Jacksonville, FL",
    "Ocala, FL",
    # Alabama
    "Birmingham, AL",
    "Huntsville, AL",
    "Tuscaloosa, AL",
    # Tennessee
    "Memphis, TN",
    "Nashville, TN",
    # Missouri
    "Kansas City, MO",
    "St. Louis, MO",
    # Carolinas
    "Charlotte, NC",
    "Columbia, SC",
    "Greenville, SC",
]


def get_active_markets():
    """Fetch markets from market_targets table if available."""
    conn = get_db_connection()
    if not conn:
        return DEFAULT_MARKETS

    try:
        cursor = conn.cursor()
        # Check if table exists
        cursor.execute("SELECT to_regclass('public.market_targets');")
        if cursor.fetchone()[0]:
            cursor.execute("SELECT location FROM market_targets WHERE is_active = TRUE;")
            rows = cursor.fetchall()
            if rows:
                return [row[0] for row in rows]
    except Exception as e:
        print(f"Warning: Could not fetch market_targets: {e}")
    finally:
        if conn: conn.close()
    
    return DEFAULT_MARKETS


def get_last_scrape_time(location: str) -> datetime | None:
    """Check when we last scraped rentals for a location."""
    conn = get_db_connection()
    if not conn:
        return None

    try:
        cursor = conn.cursor()
        city = location.split(',')[0].strip()
        query = """
            SELECT created_at FROM rental_listings 
            WHERE city ILIKE %s
            ORDER BY created_at DESC LIMIT 1
        """
        cursor.execute(query, (f"%{city}%",))
        result = cursor.fetchone()
        
        if result:
            return result[0]
    except Exception as e:
        print(f"Warning: Could not check last scrape time for {location}: {e}")
    finally:
        if conn: conn.close()
    
    return None


def should_scrape(location: str, min_hours: int = 20) -> bool:
    """Determine if we should scrape this location (avoid too frequent scrapes)."""
    last_scrape = get_last_scrape_time(location)
    if last_scrape is None:
        return True
    
    # Ensure timezone awareness compatibility
    if last_scrape.tzinfo is None:
        # Assume UTC if naive
        last_scrape = last_scrape.replace(tzinfo=datetime.now().astimezone().tzinfo)

    hours_since = (datetime.now(last_scrape.tzinfo) - last_scrape).total_seconds() / 3600
    return hours_since >= min_hours


def run_rental_scrape_cycle(past_days: int = 14):
    """
    Main scraping cycle. Iterates through all markets and collects rental data.
    
    Args:
        past_days: How far back to look for listings (default 14 days for freshness)
    """
    markets = get_active_markets()
    print(f"\n{'='*60}")
    print(f"RENTAL SCRAPE CYCLE - {datetime.now().isoformat()}")
    print(f"{'='*60}")
    print(f"Markets to process: {len(markets)}")
    
    stats = {
        "total_markets": len(markets),
        "scraped": 0,
        "skipped": 0,
        "failed": 0,
        "total_listings": 0
    }
    
    for i, location in enumerate(markets, 1):
        print(f"\n[{i}/{len(markets)}] Processing: {location}")
        
        # Check if we should scrape
        if not should_scrape(location):
            print(f"  ⏭️  Skipped (recently scraped)")
            stats["skipped"] += 1
            continue
        
        try:
            # Call the existing fetch_rentals function
            fetch_rentals(location, past_days=past_days)
            stats["scraped"] += 1
            
            # Rate limiting to be respectful to the data source
            time.sleep(3)
            
        except Exception as e:
            print(f"  ❌ Error: {e}")
            stats["failed"] += 1
            time.sleep(5)  # Longer wait after error
    
    # Get final count
    conn = get_db_connection()
    if conn:
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM rental_listings")
            stats["total_listings"] = cursor.fetchone()[0]
        except:
            pass
        finally:
            conn.close()
    
    print(f"\n{'='*60}")
    print("SCRAPE CYCLE COMPLETE")
    print(f"  Markets scraped: {stats['scraped']}")
    print(f"  Markets skipped: {stats['skipped']}")
    print(f"  Markets failed: {stats['failed']}")
    print(f"  Total listings in DB: {stats['total_listings']}")
    print(f"{'='*60}\n")
    
    return stats


def run_continuous(interval_hours: int = 24):
    """Run the scraper continuously with specified interval."""
    print(f"Starting continuous rental scraper (interval: {interval_hours}h)")
    
    while True:
        try:
            run_rental_scrape_cycle()
        except Exception as e:
            print(f"Cycle failed: {e}")
        
        print(f"Sleeping for {interval_hours} hours...")
        time.sleep(interval_hours * 3600)


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Rental Listings Scraper Scheduler")
    parser.add_argument("--once", action="store_true", help="Run once and exit")
    parser.add_argument("--past-days", type=int, default=14, help="Days to look back for listings")
    parser.add_argument("--interval", type=int, default=24, help="Hours between scrape cycles")
    
    args = parser.parse_args()
    
    if args.once:
        run_rental_scrape_cycle(past_days=args.past_days)
    else:
        run_continuous(interval_hours=args.interval)
