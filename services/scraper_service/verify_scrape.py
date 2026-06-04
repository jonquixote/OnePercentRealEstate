from homeharvest import scrape_property
import pandas as pd

try:
    print("Scraping...")
    df = scrape_property(
        location="Abbeville County, SC",
        listing_type="for_sale",
        past_days=30,
    )
    print("Scrape done.")
    print(f"Type: {type(df)}")
    
    if df is None:
        print("df is None")
    elif df.empty:
        print("df is empty")
    else:
        print(f"Rows: {len(df)}")
        print("Columns:", df.columns.tolist())
        print("First Row Sample:")
        print(df.iloc[0].to_dict())

except Exception as e:
    print(f"Caught error: {e}")
    import traceback
    traceback.print_exc()
