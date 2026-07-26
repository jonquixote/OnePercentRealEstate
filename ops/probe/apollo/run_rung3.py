import sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from homeharvest import scrape_property

def get(loc, label, **kw):
    t0=time.time()
    try:
        df = scrape_property(location=loc, listing_type="for_sale", parallel=False,
                             extra_property_data=False, **kw)
    except Exception as e:
        print(f"  {label:34s} ERROR {type(e).__name__}: {str(e)[:70]}")
        return None
    n=len(df) if df is not None else 0
    z=df["zip_code"].nunique() if n else 0
    print(f"  {label:34s} rows={n:6d} zips={z:4d} {time.time()-t0:6.1f}s est_http={-(-n//200)}")
    return df

print("=== Rung 3: state (highest risk). 300s cooldown first.")
time.sleep(300)
# Delaware: small enough that a complete answer is plausible.
de = get("Delaware", "Delaware (state)", limit=10000)
if de is not None:
    print(f"      truncated={len(de) >= 10000}")

print("\n=== updated_in_past_hours — decides the recheck architecture")
time.sleep(60)
get("44120", "44120 baseline (no filter)", limit=10000)
time.sleep(30)
get("44120", "44120 updated_in_past_hours=24", limit=10000, updated_in_past_hours=24)
time.sleep(30)
get("Cuyahoga County, OH", "Cuyahoga updated_in_past_hours=24", limit=10000, updated_in_past_hours=24)
