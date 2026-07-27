"""Apollo III Tasks 2+3 — confirmations per unit capacity, by shape and past_days."""
import time, json
from pathlib import Path
from homeharvest import scrape_property
RES = Path(__file__).parent / "results"

def probe(loc, label, **kw):
    time.sleep(15)
    t0 = time.time()
    try:
        df = scrape_property(location=loc, listing_type="for_sale", parallel=False,
                             extra_property_data=False, limit=10000, **kw)
        n = len(df) if df is not None else 0
    except Exception as e:
        print(f"  {label:38s} ERROR {type(e).__name__}: {str(e)[:60]}", flush=True); return None
    w = time.time() - t0
    req = max(1, -(-n // 200))
    print(f"  {label:38s} rows={n:5d} {w:6.1f}s req~{req:3d} rows/min={n/(w/60):8.0f} rows/req={n/req:5.0f}", flush=True)
    return {"label": label, "rows": n, "wall_s": round(w,1), "req": req,
            "rows_per_min": round(n/(w/60)), "rows_per_req": round(n/req)}

out = []
print("=== Task 2: shape throughput (rows touched per unit capacity)", flush=True)
out.append(probe("44120", "ZIP 44120 (past_days=90, as prod)", past_days=90))
out.append(probe("44120", "ZIP 44120 (unlimited)"))
out.append(probe("Cuyahoga County, OH", "county FULL (unlimited)"))
out.append(probe("Cuyahoga County, OH", "county updated_in_past_hours=24", updated_in_past_hours=24))

print("\n=== Task 3: past_days cost per confirmed listing", flush=True)
for pd_ in (30, 90, None):
    lbl = f"ZIP 33020 past_days={pd_ if pd_ else 'unlimited'}"
    out.append(probe("33020", lbl, **({"past_days": pd_} if pd_ else {})))

(RES / "shape_pastdays.json").write_text(json.dumps([o for o in out if o], indent=2))
