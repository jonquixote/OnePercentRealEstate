import time
from homeharvest import scrape_property
COUNTY = "Cuyahoga County, OH"
prev = None
for h in (1, 6, 12, 24, 48, 72, 168):
    time.sleep(20)
    t0 = time.time()
    try:
        df = scrape_property(location=COUNTY, listing_type="for_sale", limit=10000,
                             parallel=False, extra_property_data=False,
                             updated_in_past_hours=h)
        n = len(df)
    except Exception as e:
        print(f"  h={h:4d}  ERROR {type(e).__name__}: {str(e)[:60]}"); break
    flag = ""
    if prev is not None and n < prev: flag = "  <-- NON-MONOTONIC"
    if prev is not None and n == prev: flag = "  <-- plateau"
    print(f"  updated_in_past_hours={h:4d}  rows={n:5d}  {time.time()-t0:5.1f}s{flag}")
    prev = n
