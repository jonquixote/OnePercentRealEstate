import os
import time
import psycopg2
from psycopg2.extras import RealDictCursor

# Database connection
DB_HOST = "infrastructure-postgres-1"
DB_NAME = "postgres"
DB_USER = "postgres"
DB_PASS = os.environ.get("POSTGRES_PASSWORD", "root_password_change_me_please")

def get_db_connection():
    return psycopg2.connect(
        host=DB_HOST,
        database=DB_NAME,
        user=DB_USER,
        password=DB_PASS
    )

def backfill_rent():
    print("Starting smart rent backfill service (Daemon Mode)...")
    
    while True:
        try:
            conn = get_db_connection()
            conn.autocommit = True
            cur = conn.cursor()
            
            # Get total count of rows needing update
            cur.execute("SELECT count(*) FROM listings WHERE (estimated_rent IS NULL OR estimated_rent = 0) AND listing_status = 'FOR_SALE' AND latitude IS NOT NULL AND longitude IS NOT NULL")
            count = cur.fetchone()[0]
            
            if count == 0:
                print("No pending properties. Sleeping for 60s...")
                time.sleep(60)
                conn.close()
                continue
                
            print(f"Found {count} properties needing rent estimation.")
            
            # Process in batches
            batch_size = 500
            total_processed = 0
            
            while True:
                # Select batch of IDs that need update
                # Order by last_updated or random to ensure we don't get stuck on the same bad rows
                cur.execute("""
                    SELECT id FROM listings 
                    WHERE (estimated_rent IS NULL OR estimated_rent = 0) 
                    AND listing_status = 'FOR_SALE' 
                    AND latitude IS NOT NULL AND longitude IS NOT NULL
                    LIMIT %s
                """, (batch_size,))
                
                rows = cur.fetchall()
                if not rows:
                    break
                    
                ids = [row[0] for row in rows]
                
                # Update using the fallback + smart logic combo via the SQL function
                # v2: Now passes property_type for non-rentable detection
                update_query = """
                    UPDATE listings 
                    SET estimated_rent = COALESCE(
                        (calculate_smart_rent(
                            latitude, 
                            longitude, 
                            bedrooms::integer, 
                            bathrooms, 
                            sqft::integer, 
                            zip_code,
                            property_type
                        )->>'active_estimate')::numeric,
                        -1
                    )
                    WHERE id = ANY(%s::uuid[])
                """
                
                cur.execute(update_query, (ids,))
                total_processed += len(ids)
                print(f"Processed batch of {len(ids)}. Total this run: {total_processed}")
                
            print("Batch run complete.")
            conn.close()
            
        except Exception as e:
            print(f"Error in backfill loop: {e}")
            time.sleep(5)  # Short sleep on error
            continue

        # Sleep before next check
        time.sleep(5)

if __name__ == "__main__":
    backfill_rent()
