from homeharvest import scrape_property
import pandas as pd
import json

def test():
    location = "Nantucket County, MA"
    print(f"Testing scrape for: {location}")
    
    try:
        df = scrape_property(
            location=location,
            listing_type="for_sale",
            past_days=30
        )
        
        if df is None or df.empty:
            print("No results found (returned empty).")
        else:
            print(f"Success! Found {len(df)} listings.")
            print(df.head(3))
            
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test()
