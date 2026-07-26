import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from homeharvest import scrape_property
from probe import Mission, Budget, run_probe

OUT = Path(__file__).parent / "results" / "rung1b-pastdays.jsonl"
m = Mission(Budget(max_requests=55), min_delay_s=20.0)

# Same ZIP, two parameterisations. The ONLY difference is past_days=30, which is
# what production passes.
for label, kw in [("no past_days", {}), ("past_days=30 (prod)", {"past_days": 30})]:
    r = run_probe(m, "33020", "zip", scrape_property, OUT, listing_type="for_sale", **kw)
    print(f"  33020 {label:22s} rows={r.rows:5d} {r.wall_s:5.1f}s blocked={r.blocked}")
    if r.blocked: print("  BLOCKED"); break
print(f"budget spent {m.budget.spent}/{m.budget.max_requests}")
