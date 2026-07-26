import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from homeharvest import scrape_property
from probe import Mission, Budget, run_probe

OUT = Path(__file__).parent / "results" / "rung1.jsonl"
m = Mission(Budget(max_requests=60), min_delay_s=20.0)
KNOWN = {"33020": 38, "74020": 13, "37060": 7}

for z in KNOWN:
    try:
        r = run_probe(m, z, "zip", scrape_property, OUT, listing_type="for_sale")
    except Exception as e:
        print(f"  {z}: HALT {type(e).__name__}: {e}"); break
    print(f"  {z:6s} rows={r.rows:5d} zips={r.distinct_zips:3d} {r.wall_s:6.1f}s "
          f"est_http={r.est_http_requests:3d} blocked={r.blocked} db_has={KNOWN[z]}"
          + (f" ERR={r.error[:60]}" if r.error else ""))
    if r.blocked: print("  BLOCKED — mission aborted"); break
print(f"budget spent {m.budget.spent}/{m.budget.max_requests}; aborted={m.aborted}")
