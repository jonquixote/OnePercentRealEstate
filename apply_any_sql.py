import os
import sys
import psycopg2
from dotenv import load_dotenv

load_dotenv('backend/.env')

if len(sys.argv) < 2:
    print("Usage: python apply_any_sql.py <filename>")
    exit(1)

filename = sys.argv[1]

db_url = os.getenv("DATABASE_URL")
if not db_url:
    password = os.getenv("SUPABASE_DB_PASSWORD")
    host = os.getenv("SUPABASE_DB_HOST")
    if password and host:
        db_url = f"postgres://postgres:{password}@{host}:5432/postgres"

if not db_url:
    print("Error: DATABASE_URL not found")
    exit(1)

try:
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    
    with open(filename, 'r') as f:
        sql = f.read()
        
    cur.execute(sql)
    conn.commit()
    print(f"Successfully applied {filename}")
    
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error applying SQL: {e}")
    exit(1)
