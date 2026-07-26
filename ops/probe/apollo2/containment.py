import time, json
from pathlib import Path
from homeharvest import scrape_property

RES = Path(__file__).parent / "results"; RES.mkdir(exist_ok=True)
CASES = [
    ("Brazoria County, TX", "77578"),
    ("East Baton Rouge Parish, LA", "70791"),
    ("Chemung County, NY", "14845"),
    ("Jackson County, WV", "26164"),
    ("Franklin County, MA", "01364"),
]

def ids(loc, **kw):
    df = scrape_property(location=loc, listing_type="for_sale", limit=10000,
                         parallel=False, extra_property_data=False, **kw)
    if df is None or len(df) == 0: return set(), 0, df
    return set(df["property_id"].dropna().astype(str)), len(df), df

out = []
print(f"  {'county':30s} {'cnty':>6s} {'zip':>5s} {'both':>5s} {'MISSED':>6s}  status of missed")
for county, zc in CASES:
    time.sleep(25)
    try:
        cid, cn, _ = ids(county)
        time.sleep(20)
        zid, zn, zdf = ids(zc)
    except Exception as e:
        print(f"  {county:30s} ERROR {type(e).__name__}: {str(e)[:50]}"); continue
    missed = zid - cid
    st = ""
    if missed and zdf is not None and "status" in zdf.columns:
        m = zdf[zdf["property_id"].astype(str).isin(missed)]
        st = ",".join(sorted(set(m["status"].dropna().astype(str))))
    trunc = "TRUNC" if cn >= 10000 else ""
    print(f"  {county:30s} {cn:6d} {zn:5d} {len(zid&cid):5d} {len(missed):6d}  {st} {trunc}")
    out.append({"county": county, "zip": zc, "county_rows": cn, "zip_rows": zn,
                "missed": len(missed), "missed_status": st})
(RES / "containment.json").write_text(json.dumps(out, indent=2))
tot_z = sum(o["zip_rows"] for o in out); tot_m = sum(o["missed"] for o in out)
print(f"\n  TOTAL: {tot_m} missed of {tot_z} zip listings ({100*tot_m/max(tot_z,1):.2f}%)")
