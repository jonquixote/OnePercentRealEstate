import sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from homeharvest import scrape_property
time.sleep(45)

def ids(loc, **kw):
    df = scrape_property(location=loc, listing_type="for_sale", parallel=False,
                         extra_property_data=False, limit=10000, **kw)
    return set(df["property_id"].dropna().astype(str)), len(df)

zid, zn = ids("44120", updated_in_past_hours=24)
time.sleep(30)
cid, cn = ids("Cuyahoga County, OH", updated_in_past_hours=24)

missing = zid - cid
print(f"  zip 44120 updated-24h : {zn} rows, {len(zid)} unique")
print(f"  county   updated-24h : {cn} rows, {len(cid)} unique")
print(f"  in_both              : {len(zid & cid)}")
print(f"  IN_ZIP_NOT_IN_COUNTY : {len(missing)}   <-- incremental containment")
if missing: print(f"  examples: {list(missing)[:5]}")
