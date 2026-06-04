import requests
import csv
import io
import os
from sqlalchemy import create_engine, text
import sys

# Database Config (Internal Docker Network)
DB_USER = "postgres"
DB_PASS = "root_password_change_me_please"
DB_HOST = "postgres"
DB_PORT = "5432"
DB_NAME = "postgres"

DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASS}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

# US Census Bureau County Data URL
CENSUS_URL = "https://www2.census.gov/geo/docs/reference/codes/files/national_county.txt"

def seed_counties():
    print("Connecting to database...")
    try:
        engine = create_engine(DATABASE_URL)
        with engine.begin() as conn:
            # Verify table exists
            conn.execute(text("SELECT 1"))
            print("Database connection successful.")
            
            # Create Tables if not exist
            print("Ensuring schema exists...")
            conn.execute(text('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'))
            
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS listings (
                    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                    source_id TEXT,
                    address TEXT NOT NULL,
                    city TEXT,
                    state TEXT,
                    zip_code TEXT,
                    price NUMERIC,
                    bedrooms NUMERIC,
                    bathrooms NUMERIC,
                    sqft NUMERIC,
                    lot_sqft NUMERIC,
                    year_built INTEGER,
                    property_type TEXT,
                    listing_type TEXT,
                    listing_status TEXT,
                    listing_date DATE,
                    sold_date DATE,
                    sold_price NUMERIC,
                    latitude NUMERIC,
                    longitude NUMERIC,
                    raw_data JSONB,
                    url TEXT,
                    property_url TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    CONSTRAINT unique_listing UNIQUE (address, listing_type, listing_date)
                );
            """))

            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS crawl_jobs (
                    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                    region_type TEXT, 
                    region_value TEXT, 
                    status TEXT DEFAULT 'pending',
                    items_found INTEGER DEFAULT 0,
                    items_inserted INTEGER DEFAULT 0,
                    error_message TEXT,
                    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    completed_at TIMESTAMP WITH TIME ZONE
                );
            """))
            print("Schema initialized.")

    except Exception as e:
        print(f"Database initialization failed: {e}")
        sys.exit(1)

    print(f"Fetching county data from {CENSUS_URL}...")
    try:
        response = requests.get(CENSUS_URL)
        response.raise_for_status()
    except Exception as e:
        print(f"Failed to fetch Census data: {e}")
        sys.exit(1)

    # Content is CSV: State, StateANSI, CountyANSI, CountyName, ClassCode
    # e.g. AL,01,001,Autauga County,H1
    
    content = response.text
    # Some lines might be weird, let's use csv reader
    f = io.StringIO(content)
    reader = csv.reader(f, delimiter=',')
    
    counties = []
    for row in reader:
        if len(row) < 4:
            continue
        
        state = row[0]
        county_name = row[3]
        
        # Format: "Autauga County, AL"
        target = f"{county_name}, {state}"
        counties.append(target)

    print(f"Found {len(counties)} counties.")
    
    # Batch Insert
    print("Inserting into crawl_jobs...")
    inserted = 0
    skipped = 0
    
    with engine.begin() as conn:
        for county_str in counties:
            # Check exist
            check_sql = text("SELECT id FROM crawl_jobs WHERE region_value = :val AND region_type = 'county'")
            res = conn.execute(check_sql, {"val": county_str}).fetchone()
            
            if not res:
                ins_sql = text("""
                    INSERT INTO crawl_jobs (region_type, region_value, status) 
                    VALUES ('county', :val, 'pending')
                """)
                conn.execute(ins_sql, {"val": county_str})
                inserted += 1
            else:
                skipped += 1
                
            if (inserted + skipped) % 100 == 0:
                print(f"Processed {inserted + skipped}...", end='\r')

    print(f"\nSeeding complete!")
    print(f"Inserted: {inserted}")
    print(f"Skipped: {skipped}")

if __name__ == "__main__":
    seed_counties()
