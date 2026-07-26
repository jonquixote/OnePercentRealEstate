import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from homeharvest import scrape_property
from probe import Mission, Budget, run_probe

OUT = Path(__file__).parent / "results" / "rung2.jsonl"
m = Mission(Budget(max_requests=45), min_delay_s=20.0)

# limit=1000 caps each probe at 5 HTTP requests. If a probe returns exactly
# 1000 it is truncated — which still answers "does this shape resolve at all".
for loc, shape in [("Hollywood, FL", "city"), ("Broward County, FL", "county"), ("Cuyahoga County, OH", "county")]:
    try:
        r = run_probe(m, loc, shape, scrape_property, OUT, listing_type="for_sale", limit=1000)
    except Exception as e:
        print(f"  {loc}: HALT {type(e).__name__}: {e}"); break
    print(f"  {loc:24s} {shape:7s} rows={r.rows:5d} zips={r.distinct_zips:4d} {r.wall_s:6.1f}s "
          f"trunc={r.truncated} blocked={r.blocked}" + (f" ERR={r.error[:70]}" if r.error else ""))
    if r.blocked: print("  BLOCKED — aborted"); break
print(f"budget spent {m.budget.spent}/{m.budget.max_requests}; aborted={m.aborted}")
