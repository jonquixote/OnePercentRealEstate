import sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from homeharvest import scrape_property
time.sleep(20)
df = scrape_property(location="44120", listing_type="for_sale", limit=10000,
                     parallel=False, extra_property_data=False)
row = df[df["property_id"].astype(str) == "4922521823"]
cols = [c for c in ("property_id","street","city","state","zip_code","county","status","list_price") if c in df.columns]
print(row[cols].to_string(index=False) if len(row) else "not found")
print("\n--- county values present in the 44120 result:")
if "county" in df.columns:
    print(df["county"].value_counts().head(5).to_string())
