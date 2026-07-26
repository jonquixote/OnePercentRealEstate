import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from homeharvest import scrape_property
from probe import Mission, Budget, run_probe

OUT = Path(__file__).parent / "results" / "rung2b-containment.jsonl"
m = Mission(Budget(max_requests=30), min_delay_s=20.0)

def ids(df):
    for col in ("property_id", "mls_id", "property_url"):
        if df is not None and col in df.columns:
            return set(df[col].dropna().astype(str)), col
    return set(), "?"

res = {}
for loc, shape in [("74020", "zip"), ("Pawnee County, OK", "county")]:
    r = run_probe(m, loc, shape, scrape_property, OUT, listing_type="for_sale", limit=5000)
    print(f"  {loc:20s} {shape:6s} rows={r.rows:5d} trunc={r.truncated} blocked={r.blocked}")
    if r.blocked: sys.exit("BLOCKED")
    df = scrape_property(location=loc, listing_type="for_sale", limit=5000,
                         parallel=False, extra_property_data=False)
    res[shape], key = ids(df)

zip_ids, county_ids = res["zip"], res["county"]
missing = zip_ids - county_ids
print(f"\n  identifier column   : {key}")
print(f"  zip listings        : {len(zip_ids)}")
print(f"  county listings     : {len(county_ids)}")
print(f"  in_both             : {len(zip_ids & county_ids)}")
print(f"  in_county_not_zip   : {len(county_ids - zip_ids)}")
print(f"  IN_ZIP_NOT_IN_COUNTY: {len(missing)}   <-- decides everything")
if missing: print(f"  examples: {list(missing)[:3]}")
