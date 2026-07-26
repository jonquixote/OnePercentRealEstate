"""Apollo II Task 3 — find the source's rate ceiling. Designed to get blocked."""
import time, json, itertools
from pathlib import Path
from homeharvest import scrape_property

RES = Path(__file__).parent / "results"; RES.mkdir(exist_ok=True)
LOG = RES / "ceiling.jsonl"
# Small ZIPs = ~1 HTTP request each, so req/min is controlled by pacing, not size.
ZIPS = ["37060","74020","26164","01364","14845","70791","44120","33020","77578","15201"]
TIERS = [(6,5),(12,5),(30,5),(60,5),(120,10)]  # (req/min, minutes)

def blocked(e):
    t=f"{type(e).__name__}: {e}".lower()
    return any(s in t for s in ("403","forbidden","authentication","429","captcha","challenge"))

cyc = itertools.cycle(ZIPS)
stop = None
for rpm, mins in TIERS:
    gap = 60.0/rpm; sent=ok=0; first_fail=None
    print(f"\n=== tier {rpm} req/min for {mins} min (gap {gap:.1f}s)")
    t_end = time.time() + mins*60
    while time.time() < t_end:
        z = next(cyc); t0=time.time()
        try:
            df = scrape_property(location=z, listing_type="for_sale", limit=200,
                                 parallel=False, extra_property_data=False)
            ok += 1
        except Exception as e:
            first_fail = first_fail or f"{type(e).__name__}: {str(e)[:90]}"
            with LOG.open("a") as fh:
                fh.write(json.dumps({"rpm":rpm,"zip":z,"err":str(e)[:200],"blocked":blocked(e)})+"\n")
            if blocked(e):
                print(f"  BLOCKED at {rpm} req/min after {sent+1} requests: {first_fail}")
                stop = (rpm, sent+1, first_fail); break
        sent += 1
        time.sleep(max(0, gap - (time.time()-t0)))
    print(f"  tier {rpm}: sent={sent} ok={ok} fails={sent-ok} first_fail={first_fail}")
    with LOG.open("a") as fh:
        fh.write(json.dumps({"tier_summary":True,"rpm":rpm,"sent":sent,"ok":ok,"first_fail":first_fail})+"\n")
    if stop: break

print("\n=== RESULT:", f"blocked at {stop[0]} req/min" if stop else "NEVER BLOCKED up to 120 req/min")
