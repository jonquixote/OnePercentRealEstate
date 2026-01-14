import os
import psycopg2
from dotenv import load_dotenv

load_dotenv('backend/.env')

db_url = os.getenv("DATABASE_URL")
if not db_url:
    # Try to construct it if we have other vars
    # postgres://postgres:[password]@[host]:[port]/postgres
    password = os.getenv("SUPABASE_DB_PASSWORD")
    host = os.getenv("SUPABASE_DB_HOST")
    if password and host:
        db_url = f"postgres://postgres:{password}@{host}:5432/postgres"

if not db_url:
    print("Error: DATABASE_URL not found in backend/.env")
    exit(1)

try:
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    
    with open('secure_rls.sql', 'r') as f:
        sql = f.read()
        
    cur.execute(sql)
    conn.commit()
    print("Successfully applied secure_rls.sql")
    
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error applying SQL: {e}")
    exit(1)
