"""Apollo II Task 1 — what does updated_in_past_hours actually capture?

Snapshot now (t0), re-snapshot in 24h, diff the truth against what the filter
returned. Also characterises the incremental set immediately, without waiting.
"""
import sys, json, time
from pathlib import Path
from homeharvest import scrape_property

HERE = Path(__file__).parent
RES = HERE / "results"
RES.mkdir(exist_ok=True)
COUNTY = "Cuyahoga County, OH"
KEEP = ["property_id", "list_price", "status", "days_on_market", "list_date",
        "last_sold_date", "zip_code", "street"]

def snap(label, **kw):
    t0 = time.time()
    df = scrape_property(location=COUNTY, listing_type="for_sale", limit=10000,
                         parallel=False, extra_property_data=False, **kw)
    cols = [c for c in KEEP if c in df.columns]
    recs = df[cols].to_dict("records")
    for r in recs:
        for k, v in r.items():
            r[k] = None if v is None else str(v)
    p = RES / f"{label}.json"
    p.write_text(json.dumps(recs))
    print(f"  {label:18s} rows={len(recs):5d} {time.time()-t0:6.1f}s -> {p.name}")
    return recs

if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "t0"
    if which == "t0":
        full = snap("t0_full")
        time.sleep(30)
        inc = snap("t0_inc24", updated_in_past_hours=24)
        fi = {r["property_id"] for r in full}
        ii = {r["property_id"] for r in inc}
        print(f"\n  inc24 subset of full? {ii <= fi}  (outside full: {len(ii - fi)})")
        byid = {r["property_id"]: r for r in full}
        import collections
        c = collections.Counter(byid[p]["status"] for p in (ii & fi) if p in byid)
        call = collections.Counter(r["status"] for r in full)
        print("\n  status distribution — incremental set vs whole county:")
        for st, n in call.most_common(6):
            print(f"    {st:14s} all={n:5d}  inc24={c.get(st,0):4d}  ({100*c.get(st,0)/n:5.1f}%)")
