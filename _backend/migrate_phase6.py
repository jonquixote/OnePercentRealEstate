import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv(dotenv_path='../.env.local')

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Warning: Missing Supabase credentials in .env.local")
    print("Skipping client initialization (Automation will fail, but SQL generation works).")
    supabase = None
else:
    try:
        supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception as e:
        print(f"Warning: Client init failed: {e}")
        supabase = None

# SQL statements to run via RPC or just printing for manual run if RPC restricted.
# Supabase-py doesn't support raw SQL execution easily without a stored procedure like `exec_sql`.
# However, we can use the PostgREST API to inspect, but not DDL.
# If we cannot run DDL via python client easily (unless we have a function), 
# I will print the SQL and ask the user to run it, OR use a pg connection if possible.
# BUT, since I'm an agent, I can try to use the REST API if there is an `rpc/exec_sql` function. 
# Usually requests don't have one.
# 
# ALTERNATIVE: Use `psql` command if installed?
# Let's try to see if we can use a standard postgres library, but I don't want to install dependencies that might fail.
# 
# Wait, I can likely just output the SQL to a file and tell the user, 
# BUT I want to automate it.
# 
# Actually, I can create a migration file and maybe `supabase` CLI is installed?
# Checking if supabase CLI is available.

def migrate():
    print("Migration Script Prepared.")
    print("Please run the following SQL in your Supabase SQL Editor:")
    print("-" * 50)
    print("""
-- Add Sold Data Columns
ALTER TABLE properties ADD COLUMN IF NOT EXISTS sold_price NUMERIC;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS sold_date DATE;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS property_type TEXT;

-- Create Market Targets Table
CREATE TABLE IF NOT EXISTS market_targets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location TEXT UNIQUE NOT NULL,
  listing_type TEXT DEFAULT 'for_sale',
  frequency_hours INT DEFAULT 24,
  last_scraped TIMESTAMP WITH TIME ZONE,
  priority INT DEFAULT 5,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for market_targets
ALTER TABLE market_targets ENABLE ROW LEVEL SECURITY;

-- Policy (Open for Service Role, Read-only for authenticated maybe?)
CREATE POLICY "Enable read access for all users" ON market_targets FOR SELECT USING (true);
    """)
    print("-" * 50)

if __name__ == "__main__":
    migrate()
