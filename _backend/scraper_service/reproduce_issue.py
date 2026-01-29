from homeharvest import scrape_property
import pandas as pd
import json

def test_scrape():
    location = "Sandy Hook, KY"
    listing_type = "for_sale"
    past_days = 30
    
    print(f"Scraping {location} ({listing_type})...")
    
    try:
        df = scrape_property(
            location=location,
            listing_type=listing_type,
            past_days=past_days
        )
        
        if df is None or df.empty:
            print("No results found.")
            return

        print(f"Columns found: {df.columns.tolist()}")
        
        # Convert to records to see actual data structure
        records = df.to_dict(orient="records")
        
        # Print first record to verify fields
        if records:
            first_record = records[0]
            print("\nFirst Record Sample:")
            print(json.dumps(first_record, indent=2, default=str))
            
            # Check for critical fields
            critical_fields = ['list_price', 'beds', 'full_baths', 'latitude', 'longitude', 'primary_photo']
            missing = [f for f in critical_fields if f not in first_record]
            if missing:
                print(f"\nWARNING: Missing critical fields in output: {missing}")
            else:
                print("\nSUCCESS: All critical fields present in output.")
                
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_scrape()
