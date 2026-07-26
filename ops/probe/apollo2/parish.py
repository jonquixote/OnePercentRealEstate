import time
from homeharvest import scrape_property
def probe(loc):
    time.sleep(20)
    try:
        df = scrape_property(location=loc, listing_type="for_sale", limit=10000,
                             parallel=False, extra_property_data=False)
        n=len(df); z=df["zip_code"].nunique() if n else 0
        has = "70791" in set(df["zip_code"].dropna().astype(str)) if n else False
        cities = ",".join(sorted(set(df["city"].dropna().astype(str)))[:3]) if n and "city" in df.columns else ""
        print(f"  {loc:34s} rows={n:5d} zips={z:3d} has_70791={has}  cities={cities}")
    except Exception as e:
        print(f"  {loc:34s} ERROR {type(e).__name__}: {str(e)[:50]}")
for loc in ["East Baton Rouge Parish, LA", "East Baton Rouge County, LA",
            "East Baton Rouge, LA", "Zachary, LA", "70791"]:
    probe(loc)
