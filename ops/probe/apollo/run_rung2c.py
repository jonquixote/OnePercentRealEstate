import sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from homeharvest import scrape_property

print("cooldown 120s before the largest burst of the mission...")
time.sleep(120)

def get(loc, **kw):
    t0=time.time()
    df = scrape_property(location=loc, listing_type="for_sale", parallel=False,
                         extra_property_data=False, **kw)
    n=len(df) if df is not None else 0
    print(f"  {loc:22s} rows={n:6d} {time.time()-t0:6.1f}s est_http={-(-n//200)}")
    return df

# Cuyahoga truncated at 1000 earlier. Ask for the real size.
county = get("Cuyahoga County, OH", limit=10000)
time.sleep(30)
zipdf  = get("44120", limit=10000)

cid = set(county["property_id"].dropna().astype(str))
zid = set(zipdf["property_id"].dropna().astype(str))
missing = zid - cid
print(f"\n  county unique       : {len(cid)}")
print(f"  zip 44120 unique    : {len(zid)}")
print(f"  in_both             : {len(zid & cid)}")
print(f"  IN_ZIP_NOT_IN_COUNTY: {len(missing)}   <-- the whale test")
print(f"  county truncated    : {len(county) >= 10000}")
if missing: print(f"  examples: {list(missing)[:5]}")
