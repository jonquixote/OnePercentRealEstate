"""Apollo III Task 1 — how much concurrency does the source tolerate?

Apollo I and II were STRICTLY SERIAL, so both found our own ~28 req/min latency
bound, not the source's limit. This is the untested axis. Designed to end in a
block; aborts at the first structured signal.
"""
import json, time, sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from homeharvest import scrape_property

RES = Path(__file__).parent / "results"; RES.mkdir(exist_ok=True)
LOG = RES / "concurrency.jsonl"
ZIPS = ["37060","74020","26164","01364","14845","70791","44120","33020","77578","15201",
        "43701","63104","78613","80003","72715","73099","44120","33626","15201","44102"]
LEVELS = [1, 2, 3, 5, 8]
PER_LEVEL = 20

def blocked(e):
    t = f"{type(e).__name__}: {e}".lower()
    return any(s in t for s in ("403","forbidden","authentication","429","captcha","challenge"))

def one(z):
    t0 = time.time()
    try:
        df = scrape_property(location=z, listing_type="for_sale", limit=200,
                             parallel=False, extra_property_data=False)
        return {"zip": z, "rows": len(df) if df is not None else 0,
                "s": round(time.time()-t0, 2), "err": None, "blocked": False}
    except Exception as e:
        return {"zip": z, "rows": 0, "s": round(time.time()-t0, 2),
                "err": f"{type(e).__name__}: {str(e)[:120]}", "blocked": blocked(e)}

stop = None
for lvl in LEVELS:
    print(f"\n=== concurrency {lvl} ({PER_LEVEL} scrapes)", flush=True)
    t0 = time.time()
    results = []
    with ThreadPoolExecutor(max_workers=lvl) as ex:
        futs = [ex.submit(one, ZIPS[i % len(ZIPS)]) for i in range(PER_LEVEL)]
        for f in as_completed(futs):
            r = f.result(); results.append(r)
            if r["blocked"]:
                stop = (lvl, r["err"])
    wall = time.time() - t0
    ok = sum(1 for r in results if r["err"] is None)
    errs = [r["err"] for r in results if r["err"]]
    rpm = round(PER_LEVEL / (wall/60), 1)
    rec = {"level": lvl, "sent": PER_LEVEL, "ok": ok, "wall_s": round(wall,1),
           "req_per_min": rpm, "blocked": bool(stop), "errors": errs[:3]}
    with LOG.open("a") as fh: fh.write(json.dumps(rec) + "\n")
    print(f"  ok={ok}/{PER_LEVEL} wall={wall:.1f}s rate={rpm}/min blocked={bool(stop)}", flush=True)
    if errs: print(f"  first error: {errs[0]}", flush=True)
    if stop:
        print(f"\n=== BLOCKED at concurrency {stop[0]}: {stop[1]}", flush=True)
        break
    time.sleep(60)

print("\n=== RESULT:", f"blocked at level {stop[0]}" if stop else "NEVER BLOCKED up to concurrency 8", flush=True)
