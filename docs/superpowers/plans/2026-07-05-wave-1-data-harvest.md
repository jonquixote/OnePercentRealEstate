# Wave 1 — Free Data Harvest: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop discarding the property data homeharvest already fetches. Extract every useful field into typed columns going forward, backfill the 936K existing rows from the `raw_data` we already stored (no re-scrape), and start capturing price/status changes over time.

**Architecture:** One migration adds the missing columns + a coverage view + a backfill marker (all nullable/instant). The Python scraper gains a tested pure-function `extract_enrichment(row)` that maps a homeharvest record to those columns, wired into the existing `INSERT … SELECT`. A resumable out-of-band procedure backfills existing rows straight from `raw_data` (rent-queue-safe, mirrors the proven sale_type backfill). An `AFTER UPDATE` trigger on `listings` writes a `listings_history` row when price/status/DOM changes.

**Tech Stack:** Postgres 16 (migrations via `apps/one/src/scripts/migrate.ts`, OOB via `psql`), Python 3.11 + homeharvest + psycopg2 (`services/scraper_service`), pytest (new to this service).

**Spec:** `docs/superpowers/specs/2026-07-05-full-upgrade-v2-design.md` (Wave 1). **Predecessor:** Wave 0 (`wave/0-bleed-stop`, PR #2) — must be merged first.

## Global Constraints

- Server: `ssh root@209.94.61.108`; repo at `/opt/onepercent` (rsync, not a git checkout). Deploy via `/opt/onepercent/infrastructure/deploy.sh <compose args>` (sources `.env` → `docker compose -f infrastructure/docker-compose.yml`).
- **Migration runner** (`migrate.ts`): every file in `infrastructure/migrations/*.sql` runs inside ONE `BEGIN … COMMIT` and is auto-recorded in `schema_migrations` (no manual INSERT in the file). Anything needing `CREATE INDEX CONCURRENTLY` or per-batch commits MUST be an out-of-band file in `infrastructure/migrations/out-of-band/`, run by hand with `psql`.
- **Large-table discipline on `listings` (≈940K rows):** column adds are nullable (instant, no rewrite — Postgres 11+ default-less add is metadata-only). Backfills are keyset-batched with `FOR UPDATE SKIP LOCKED` + per-batch `COMMIT` + a marker column. Never hold a long lock on `listings`.
- **Rent-queue safety (load-bearing):** the backfill and the history trigger must NOT touch `estimated_rent`, `rent_calc_status`, or `updated_at`, and must not fire the rent NOTIFY trigger (`trg_rent_job_enqueue`). Re-enqueuing 940K rent jobs would swamp the Wave-0 drain. Task 1 Step 1 verifies exactly what that trigger fires on before anything writes.
- **n8n freeze:** run the backfill (Task 4) and column-add deploy (Task 6) inside an n8n freeze window per `documentation/operations/n8n-freeze.md` so the scraper isn't upserting into a table mid-migration. Unfreeze immediately after.
- Branch: `wave/1-data-harvest` off `main` (after Wave 0 merges). Commit per task.
- Verify locally before deploy: `pnpm --filter @oper/one typecheck` (migration is SQL, but the app imports column names nowhere yet); scraper changes verified by pytest + a one-ZIP live scrape.

---

### Task 0: Branch + coverage baseline

**Files:**
- Create: `docs/superpowers/plans/2026-07-05-wave-1-baseline.md`

**Interfaces:**
- Produces: branch `wave/1-data-harvest`; the "before" coverage numbers every later task compares against.

- [ ] **Step 1: Branch (after Wave 0 is merged to main)**

```bash
cd /Users/johnny/Code/OnePercentRealEstate
git checkout main && git pull
git checkout -b wave/1-data-harvest
```

- [ ] **Step 2: Capture coverage baseline from prod**

```bash
ssh root@209.94.61.108 'docker exec infrastructure-postgres-1 psql -U postgres -c "
SELECT
  count(*) total,
  count(hoa_fee) hoa_col, count(*) FILTER (WHERE raw_data->>'"'"'hoa_fee'"'"' IS NOT NULL AND raw_data->>'"'"'hoa_fee'"'"' <> '"'"'null'"'"') hoa_raw,
  count(tax_annual_amount) tax_col, count(*) FILTER (WHERE raw_data->>'"'"'tax'"'"' IS NOT NULL AND raw_data->>'"'"'tax'"'"' <> '"'"'null'"'"') tax_raw,
  count(property_url) url_col, count(*) FILTER (WHERE raw_data->>'"'"'property_url'"'"' IS NOT NULL) url_raw
FROM listings;"'
```

Record the output in `docs/superpowers/plans/2026-07-05-wave-1-baseline.md`. Expected shape (from the 2026-07-05 audit): `hoa_col≈0 / hoa_raw≈66%`, `tax_col=0 / tax_raw≈0` (needs Task 3), `url_col=0 / url_raw≈100%`.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-07-05-wave-1-baseline.md
git commit -m "wave1: coverage baseline before harvest"
```

---

### Task 1: Migration — add columns, coverage view, backfill marker

**Files:**
- Create: `infrastructure/migrations/2026_07_05_listings_enrichment_columns.sql`

**Interfaces:**
- Produces: new nullable columns on `listings`; `vw_field_coverage` view (Wave 7 retention-gate input); `enrichment_backfilled_at` marker used by Task 4. Task 2 (scraper) and Task 4 (backfill) write these columns.

- [ ] **Step 1: Verify what the rent NOTIFY trigger fires on (safety gate)**

```bash
ssh root@209.94.61.108 'docker exec infrastructure-postgres-1 psql -U postgres -c "
SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
WHERE tgrelid='"'"'listings'"'"'::regclass AND tgname='"'"'trg_rent_job_enqueue'"'"';"'
```

Read the definition. Confirm it fires on INSERT and/or `UPDATE OF estimated_rent/rent_calc_status` (or `UPDATE` unqualified). Record it in the baseline file. **If it fires on unqualified `UPDATE`,** the Task 4 backfill must set `rent_calc_status` in its `WHERE` to a no-op-safe form or the trigger body must be guarded — note it now; Task 4 Step 1 handles it. (The sale_type backfill ran safely by not touching rent columns, which implies the trigger is column-scoped — verify, don't assume.)

- [ ] **Step 2: Write the migration**

Create `infrastructure/migrations/2026_07_05_listings_enrichment_columns.sql`:

```sql
-- Wave 1: typed columns for homeharvest fields we already fetch but discard.
-- All adds are nullable + default-less => metadata-only, no table rewrite on
-- the ~940K-row listings table (safe inside the runner's single txn).

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS county            TEXT,
  ADD COLUMN IF NOT EXISTS fips_code         TEXT,
  ADD COLUMN IF NOT EXISTS neighborhoods     TEXT,
  ADD COLUMN IF NOT EXISTS last_sold_price   NUMERIC,
  ADD COLUMN IF NOT EXISTS last_sold_date    DATE,
  ADD COLUMN IF NOT EXISTS assessed_value    NUMERIC,
  ADD COLUMN IF NOT EXISTS estimated_value   NUMERIC,
  ADD COLUMN IF NOT EXISTS description        TEXT,
  ADD COLUMN IF NOT EXISTS style             TEXT,
  ADD COLUMN IF NOT EXISTS new_construction  BOOLEAN,
  ADD COLUMN IF NOT EXISTS list_date         DATE,
  ADD COLUMN IF NOT EXISTS price_per_sqft    NUMERIC,
  -- backfill marker: NULL = not yet enriched from raw_data (Task 4 uses it).
  ADD COLUMN IF NOT EXISTS enrichment_backfilled_at TIMESTAMPTZ;
-- hoa_fee, tax_annual_amount, property_url already exist (empty) — populated,
-- not added.

-- Coverage observability. Pinned as a VIEW (spec §Wave1 item6) — it is the
-- input to the Wave 7 raw_data retention gate. Percentages of non-null typed
-- columns vs what raw_data carries, so we can prove extraction completeness
-- before anything is discarded.
CREATE OR REPLACE VIEW vw_field_coverage AS
SELECT
  count(*)                                                             AS total,
  round(100.0 * count(hoa_fee)          / nullif(count(*),0), 1)       AS pct_hoa,
  round(100.0 * count(tax_annual_amount)/ nullif(count(*),0), 1)       AS pct_tax,
  round(100.0 * count(property_url)     / nullif(count(*),0), 1)       AS pct_url,
  round(100.0 * count(county)           / nullif(count(*),0), 1)       AS pct_county,
  round(100.0 * count(estimated_value)  / nullif(count(*),0), 1)       AS pct_est_value,
  round(100.0 * count(last_sold_price)  / nullif(count(*),0), 1)       AS pct_last_sold,
  round(100.0 * count(description)      / nullif(count(*),0), 1)       AS pct_description,
  count(*) FILTER (WHERE enrichment_backfilled_at IS NULL)             AS unenriched_rows
FROM listings;
```

- [ ] **Step 3: Apply to prod (inside an n8n freeze window)**

Freeze n8n (`documentation/operations/n8n-freeze.md`), then run the migration. Migrations run from a machine with the repo + prod `DATABASE_URL`; the app container has both:

```bash
# freeze first
ssh root@209.94.61.108 'docker exec infrastructure-n8n-1 n8n update:workflow --id r31g9HwLPPjrE8pO --active=false && docker restart infrastructure-n8n-1'
# rsync repo, then run the migrator inside the app container
rsync -az --exclude node_modules --exclude .next --exclude .git --exclude .venv --exclude venv --exclude .turbo /Users/johnny/Code/OnePercentRealEstate/ root@209.94.61.108:/opt/onepercent/
ssh root@209.94.61.108 'docker exec infrastructure-app-1 node apps/one/dist/scripts/migrate.js 2>/dev/null || docker exec -w /app infrastructure-app-1 npx tsx apps/one/src/scripts/migrate.ts'
```

If neither invocation path exists in the image, fall back to piping the SQL directly (it is a single txn already):

```bash
ssh root@209.94.61.108 'docker exec -i infrastructure-postgres-1 psql -U postgres -d postgres -v ON_ERROR_STOP=1' < infrastructure/migrations/2026_07_05_listings_enrichment_columns.sql
ssh root@209.94.61.108 "docker exec infrastructure-postgres-1 psql -U postgres -c \"INSERT INTO schema_migrations(version) VALUES('2026_07_05_listings_enrichment_columns') ON CONFLICT DO NOTHING;\""
```

**Acceptance:**

```bash
ssh root@209.94.61.108 'docker exec infrastructure-postgres-1 psql -U postgres -c "SELECT * FROM vw_field_coverage;"'
```

Expect the view to return one row; all `pct_*` near 0 pre-backfill except any columns already populated. Record it. (Leave n8n frozen through Task 4, or unfreeze now and re-freeze for Task 4 — either is fine; the column adds are forward-compatible with the old scraper, which ignores unknown columns.)

- [ ] **Step 4: Commit**

```bash
git add infrastructure/migrations/2026_07_05_listings_enrichment_columns.sql
git commit -m "wave1: add enrichment columns + vw_field_coverage + backfill marker"
```

---

### Task 2: Scraper extraction — `extract_enrichment()` + wire into INSERT (TDD)

**Files:**
- Create: `services/scraper_service/enrichment.py`
- Create: `services/scraper_service/test_enrichment.py`
- Create: `services/scraper_service/requirements-dev.txt` (pytest)
- Modify: `services/scraper_service/main.py` (the `listings` `INSERT … SELECT`, ≈ lines 258–312)

**Interfaces:**
- Produces: `extract_enrichment(row: dict) -> dict` returning keys `{county, fips_code, neighborhoods, last_sold_price, last_sold_date, assessed_value, estimated_value, description, style, new_construction, list_date, price_per_sqft, hoa_fee, tax_annual_amount, property_url}` with parsed/typed values (or `None`). Consumed by the INSERT in `main.py`.

- [ ] **Step 1: Write the failing tests**

Create `services/scraper_service/test_enrichment.py`:

```python
import datetime as dt
from enrichment import extract_enrichment


def test_maps_and_types_a_full_homeharvest_row():
    row = {
        "county": "Harris", "fips_code": "48201",
        "neighborhoods": "Montrose, Midtown",
        "last_sold_price": "250000", "last_sold_date": "2019-06-01",
        "assessed_value": 210000.0, "estimated_value": 305000.0,
        "text": "Charming bungalow.", "style": "SINGLE_FAMILY",
        "new_construction": False, "list_date": "2026-07-01",
        "price_per_sqft": 180, "hoa_fee": "45", "tax": 5400.0,
        "property_url": "https://realtor.com/x",
    }
    out = extract_enrichment(row)
    assert out["county"] == "Harris"
    assert out["fips_code"] == "48201"
    assert out["neighborhoods"] == "Montrose, Midtown"
    assert out["last_sold_price"] == 250000.0
    assert out["last_sold_date"] == dt.date(2019, 6, 1)
    assert out["estimated_value"] == 305000.0
    assert out["description"] == "Charming bungalow."
    assert out["style"] == "SINGLE_FAMILY"
    assert out["new_construction"] is False
    assert out["list_date"] == dt.date(2026, 7, 1)
    assert out["price_per_sqft"] == 180.0
    assert out["hoa_fee"] == 45.0
    assert out["tax_annual_amount"] == 5400.0
    assert out["property_url"] == "https://realtor.com/x"


def test_missing_and_nan_become_none():
    row = {"county": None, "tax": float("nan"), "hoa_fee": "", "last_sold_date": "nan"}
    out = extract_enrichment(row)
    assert out["county"] is None
    assert out["tax_annual_amount"] is None
    assert out["hoa_fee"] is None
    assert out["last_sold_date"] is None
    assert out["property_url"] is None  # absent key


def test_neighborhoods_list_is_joined():
    assert extract_enrichment({"neighborhoods": ["A", "B"]})["neighborhoods"] == "A, B"


def test_bad_numbers_do_not_raise():
    out = extract_enrichment({"price_per_sqft": "N/A", "assessed_value": "$210,000"})
    assert out["price_per_sqft"] is None
    assert out["assessed_value"] == 210000.0  # currency stripped
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
cd services/scraper_service && python3 -m pytest test_enrichment.py -q
```

Expected: FAIL — `ModuleNotFoundError: No module named 'enrichment'`.

- [ ] **Step 3: Implement `enrichment.py`**

Create `services/scraper_service/enrichment.py`:

```python
"""Map a homeharvest DataFrame row (as a dict) to typed enrichment columns.

Kept pure + dependency-free (no pandas) so it is unit-testable and reused by
both the live scraper insert and any future re-processing. The scraper already
NaN-normalizes raw_data before calling us, but we defend anyway."""
from __future__ import annotations

import datetime as dt
import re
from typing import Any, Optional

_NUM_RE = re.compile(r"[^0-9.\-]")


def _num(v: Any) -> Optional[float]:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return None if v != v else float(v)  # v!=v catches NaN
    s = str(v).strip()
    if not s or s.lower() in ("nan", "none", "n/a", "null"):
        return None
    s = _NUM_RE.sub("", s)
    if s in ("", "-", ".", "-."):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _date(v: Any) -> Optional[dt.date]:
    if v is None:
        return None
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    s = str(v).strip()
    if not s or s.lower() in ("nan", "none", "null"):
        return None
    try:
        return dt.date.fromisoformat(s[:10])
    except ValueError:
        return None


def _text(v: Any) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, (list, tuple)):
        parts = [str(x).strip() for x in v if x is not None and str(x).strip()]
        return ", ".join(parts) or None
    s = str(v).strip()
    if not s or s.lower() in ("nan", "none", "null"):
        return None
    return s


def _bool(v: Any) -> Optional[bool]:
    if v is None or (isinstance(v, float) and v != v):
        return None
    if isinstance(v, bool):
        return v
    s = str(v).strip().lower()
    if s in ("true", "t", "1", "yes"):
        return True
    if s in ("false", "f", "0", "no"):
        return False
    return None


def extract_enrichment(row: dict) -> dict:
    return {
        "county": _text(row.get("county")),
        "fips_code": _text(row.get("fips_code")),
        "neighborhoods": _text(row.get("neighborhoods")),
        "last_sold_price": _num(row.get("last_sold_price")),
        "last_sold_date": _date(row.get("last_sold_date")),
        "assessed_value": _num(row.get("assessed_value")),
        "estimated_value": _num(row.get("estimated_value")),
        "description": _text(row.get("text")),  # homeharvest calls it 'text'
        "style": _text(row.get("style")),
        "new_construction": _bool(row.get("new_construction")),
        "list_date": _date(row.get("list_date")),
        "price_per_sqft": _num(row.get("price_per_sqft")),
        "hoa_fee": _num(row.get("hoa_fee")),
        "tax_annual_amount": _num(row.get("tax")),  # homeharvest calls it 'tax'
        "property_url": _text(row.get("property_url")),
    }
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
cd services/scraper_service && python3 -m pytest test_enrichment.py -q
```

Expected: PASS (4 tests). Add `pytest` to a new `services/scraper_service/requirements-dev.txt`.

- [ ] **Step 5: Wire into the `listings` INSERT in `main.py`**

The insert is an `INSERT … SELECT` (≈ lines 258–312). Add the 15 enrichment columns to the column list, add matching `%s` placeholders to the `SELECT`, add them to the `DO UPDATE SET`, and extend the params tuple. Immediately before the `cursor.execute("""INSERT INTO listings …` for the non-rental branch, compute:

```python
                    enr = extract_enrichment(raw_data)
```

(`raw_data` is the per-row dict already built at line 212, with NaN→None and dates ISO-stringified, and `lat`/`lon` injected — `extract_enrichment` is null-safe against all of that.)

In the INSERT column list, after `address_norm, address_hash` add:
```
                            , county, fips_code, neighborhoods, last_sold_price, last_sold_date,
                            assessed_value, estimated_value, description, style, new_construction,
                            list_date, price_per_sqft, hoa_fee, tax_annual_amount, property_url
```
In the `SELECT`, after the `n.address_norm, md5(...)` line add 15 placeholders:
```
                            , %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
```
In the `DO UPDATE SET`, before `updated_at = NOW()` add:
```
                            county = EXCLUDED.county,
                            fips_code = EXCLUDED.fips_code,
                            neighborhoods = EXCLUDED.neighborhoods,
                            last_sold_price = EXCLUDED.last_sold_price,
                            last_sold_date = EXCLUDED.last_sold_date,
                            assessed_value = EXCLUDED.assessed_value,
                            estimated_value = EXCLUDED.estimated_value,
                            description = EXCLUDED.description,
                            style = EXCLUDED.style,
                            new_construction = EXCLUDED.new_construction,
                            list_date = EXCLUDED.list_date,
                            price_per_sqft = EXCLUDED.price_per_sqft,
                            hoa_fee = EXCLUDED.hoa_fee,
                            tax_annual_amount = EXCLUDED.tax_annual_amount,
                            property_url = EXCLUDED.property_url,
```
In the params tuple, after the final `address` argument (the LATERAL address_norm input, last positional before `))`), append in the SAME order as the columns:
```python
                        enr["county"], enr["fips_code"], enr["neighborhoods"],
                        enr["last_sold_price"], enr["last_sold_date"], enr["assessed_value"],
                        enr["estimated_value"], enr["description"], enr["style"],
                        enr["new_construction"], enr["list_date"], enr["price_per_sqft"],
                        enr["hoa_fee"], enr["tax_annual_amount"], enr["property_url"],
```

**Placeholder count is the failure mode.** After editing, assert the tuple length equals the `%s` count:

```bash
cd services/scraper_service && python3 -c "import ast,sys; src=open('main.py').read(); print('OK syntax' if ast.parse(src) else 'bad')"
```

- [ ] **Step 6: Verify against a one-ZIP live scrape (integration)**

Deploy the scraper to a scratch check on prod (still safe — column adds landed in Task 1), scrape ONE ZIP, confirm the new columns populate:

```bash
rsync -az --exclude node_modules --exclude .next --exclude .git --exclude .venv --exclude venv --exclude .turbo /Users/johnny/Code/OnePercentRealEstate/ root@209.94.61.108:/opt/onepercent/
ssh root@209.94.61.108 'cd /opt/onepercent && ./infrastructure/deploy.sh build scraper && ./infrastructure/deploy.sh up -d --no-deps scraper && sleep 8 && curl -s -X POST http://127.0.0.1:8001/scrape -H "content-type: application/json" -d "{\"location\":\"77006\",\"listing_type\":\"for_sale\",\"past_days\":30}" | head -c 300'
sleep 5
ssh root@209.94.61.108 'docker exec infrastructure-postgres-1 psql -U postgres -c "SELECT count(*) FILTER (WHERE property_url IS NOT NULL) url, count(*) FILTER (WHERE hoa_fee IS NOT NULL) hoa, count(*) FILTER (WHERE estimated_value IS NOT NULL) ev FROM listings WHERE zip_code='"'"'77006'"'"' AND updated_at > now() - interval '"'"'5 min'"'"';"'
```

Expected: `url` ≈ row count (near 100%), `hoa`/`ev` a healthy fraction. If the tuple/placeholder count is off, the scrape returns a 500 with a psycopg2 "not all arguments converted" — fix and redeploy.

- [ ] **Step 7: Commit**

```bash
git add services/scraper_service/enrichment.py services/scraper_service/test_enrichment.py services/scraper_service/requirements-dev.txt services/scraper_service/main.py
git commit -m "wave1: extract all homeharvest enrichment fields into typed columns (TDD)"
```

---

### Task 3: `extra_property_data` investigation — tax/tax_history/schools

**Files:**
- Modify: `services/scraper_service/main.py` (the `scrape_property(...)` call, ≈ lines 120–127)
- Create: `docs/superpowers/plans/2026-07-05-wave-1-extra-data-findings.md`

**Interfaces:**
- Produces: a measured decision on whether `extra_property_data=True` populates `tax` at acceptable request cost. Feeds Wave 3 (real tax into underwriting) — if tax stays unavailable, Wave 3 uses the `assessed_value × county millage` fallback.

- [ ] **Step 1: Measure the cost + payoff on ONE ZIP**

Temporarily add `extra_property_data=True` to the `scrape_property(...)` call. Scrape one mid-size ZIP twice — once without, once with — and compare wall-clock + tax fill rate:

```bash
# with the flag deployed to the scratch scraper, time a single ZIP:
ssh root@209.94.61.108 'time curl -s -X POST http://127.0.0.1:8001/scrape -H "content-type: application/json" -d "{\"location\":\"77006\",\"listing_type\":\"for_sale\",\"past_days\":30}" >/dev/null'
ssh root@209.94.61.108 'docker exec infrastructure-postgres-1 psql -U postgres -t -c "SELECT count(*) total, count(tax_annual_amount) tax FROM listings WHERE zip_code='"'"'77006'"'"' AND updated_at > now() - interval '"'"'10 min'"'"';"'
```

Record: seconds/ZIP with vs without, and tax fill rate. homeharvest fetches extra data per-property, so the flag can multiply latency ~N× (N = listings/ZIP). The crawl fires ~2880 ZIP-jobs/day; a large multiplier could stall ingestion.

- [ ] **Step 2: Decide and encode**

Write the finding to `docs/superpowers/plans/2026-07-05-wave-1-extra-data-findings.md`, then:

- **If tax fills well AND cost ≤ ~2× per ZIP:** keep `extra_property_data=True`.
- **If cost is high but tax is valuable:** enable it only on a sampled subset (e.g. a dedicated slow lane, or every Nth ZIP) — document the sampling; do not slow the main crawl.
- **If tax stays null even with the flag:** revert the flag (tax genuinely unavailable from the source at scrape time) and record that Wave 3 must derive tax from `assessed_value × county millage`. This is a real, common outcome — not a failure of this task.

- [ ] **Step 3: Commit the decision (code reflects it)**

```bash
git add services/scraper_service/main.py docs/superpowers/plans/2026-07-05-wave-1-extra-data-findings.md
git commit -m "wave1: measured extra_property_data decision (tax availability + crawl cost)"
```

---

### Task 4: Out-of-band backfill of the 936K existing rows from `raw_data`

**Files:**
- Create: `infrastructure/migrations/out-of-band/2026_07_05_backfill_enrichment.sql`

**Interfaces:**
- Consumes: Task 1 columns + marker. Produces: existing rows populated from `raw_data`; `enrichment_backfilled_at` stamped. Rent queue untouched.

- [ ] **Step 1: Write the resumable procedure (mirrors the sale_type backfill)**

Create `infrastructure/migrations/out-of-band/2026_07_05_backfill_enrichment.sql`:

```sql
-- OUT-OF-BAND: resumable, idempotent backfill of enrichment columns from the
-- raw_data JSONB we already store. Run AFTER 2026_07_05_listings_enrichment_columns.sql.
--
-- Safety (mirrors 2026_06_20_backfill_sale_type): marker = enrichment_backfilled_at
-- IS NULL; FOR UPDATE SKIP LOCKED; per-batch COMMIT; pg_sleep between batches.
-- NEVER writes estimated_rent / rent_calc_status / updated_at / price / listing_status
-- -> does not disturb the rent NOTIFY trigger or the listings_history trigger.
--
-- Usage:  CALL public.backfill_enrichment();            -- 5000/batch, 0.2s
--         CALL public.backfill_enrichment(10000, 0.1);

CREATE OR REPLACE PROCEDURE public.backfill_enrichment(
    p_batch INT DEFAULT 5000,
    p_sleep DOUBLE PRECISION DEFAULT 0.2
)
LANGUAGE plpgsql AS $$
DECLARE
    v_rows  INT;
    v_total BIGINT := 0;
BEGIN
    LOOP
        WITH batch AS (
            SELECT id FROM public.listings
            WHERE enrichment_backfilled_at IS NULL
            ORDER BY id LIMIT p_batch
            FOR UPDATE SKIP LOCKED
        )
        UPDATE public.listings l
        SET county          = nullif(l.raw_data->>'county','')::text,
            fips_code       = nullif(l.raw_data->>'fips_code','')::text,
            neighborhoods   = nullif(l.raw_data->>'neighborhoods','')::text,
            last_sold_price = nullif(l.raw_data->>'last_sold_price','')::numeric,
            last_sold_date  = nullif(l.raw_data->>'last_sold_date','')::date,
            assessed_value  = nullif(l.raw_data->>'assessed_value','')::numeric,
            estimated_value = nullif(l.raw_data->>'estimated_value','')::numeric,
            description     = nullif(l.raw_data->>'text','')::text,
            style           = nullif(l.raw_data->>'style','')::text,
            new_construction= (l.raw_data->>'new_construction')::boolean,
            list_date       = nullif(l.raw_data->>'list_date','')::date,
            price_per_sqft  = nullif(l.raw_data->>'price_per_sqft','')::numeric,
            hoa_fee         = nullif(l.raw_data->>'hoa_fee','')::numeric,
            tax_annual_amount = nullif(l.raw_data->>'tax','')::numeric,
            property_url    = nullif(l.raw_data->>'property_url','')::text,
            enrichment_backfilled_at = NOW()
        FROM batch WHERE l.id = batch.id;

        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_total := v_total + v_rows;
        COMMIT;
        RAISE NOTICE 'backfill_enrichment: % this batch (cumulative %)', v_rows, v_total;
        EXIT WHEN v_rows = 0;
        PERFORM pg_sleep(p_sleep);
    END LOOP;
    RAISE NOTICE 'backfill_enrichment complete: % rows', v_total;
END $$;
```

**Note on date/numeric casts:** a malformed `raw_data` value (e.g. a non-ISO date) would raise and abort the batch. The scraper already ISO-normalized dates and NaN→None before storing raw_data (main.py lines 212–219), so values are clean; `nullif(...,'')` handles empties. If a cast error surfaces on a batch, wrap the offending column in a `CASE`/`try` via a helper — but do not add defensive casting pre-emptively (YAGNI); the stored data is normalized.

- [ ] **Step 2: Run it (inside an n8n freeze window), load then execute**

```bash
# freeze n8n (per runbook), then:
ssh root@209.94.61.108 'docker exec -i infrastructure-postgres-1 psql -U postgres -d postgres -v ON_ERROR_STOP=1' < infrastructure/migrations/out-of-band/2026_07_05_backfill_enrichment.sql
ssh root@209.94.61.108 'docker exec infrastructure-postgres-1 psql -U postgres -c "CALL public.backfill_enrichment(10000, 0.1);"'
```

~940K rows / 10K batch ≈ 94 batches. Watch the NOTICE cumulative count. Re-runnable if interrupted (marker-based). Unfreeze n8n when done.

- [ ] **Step 3: Acceptance — coverage view**

```bash
ssh root@209.94.61.108 'docker exec infrastructure-postgres-1 psql -U postgres -c "SELECT * FROM vw_field_coverage;"'
```

Expect `unenriched_rows` → 0, `pct_url` ≈ 100, `pct_hoa` ≈ 60–66, `pct_est_value` ≈ 80, `pct_last_sold`/`pct_county` per source availability. Record before/after in the baseline file.

- [ ] **Step 4: Commit**

```bash
git add infrastructure/migrations/out-of-band/2026_07_05_backfill_enrichment.sql docs/superpowers/plans/2026-07-05-wave-1-baseline.md
git commit -m "wave1: OOB backfill enrichment columns from raw_data (rent-queue-safe)"
```

---

### Task 5: `listings_history` trigger — capture price/status changes

**Files:**
- Create: `infrastructure/migrations/2026_07_05_listings_history_trigger.sql`

**Interfaces:**
- Consumes: existing `listings_history` (listing_id, observed_at, price, estimated_rent, days_on_market, listing_status). Produces: a history row whenever a scraper upsert changes price / listing_status / days_on_market. Feeds Wave 4 price-cut UI.

- [ ] **Step 1: Write the trigger migration**

Create `infrastructure/migrations/2026_07_05_listings_history_trigger.sql`:

```sql
-- Wave 1: capture price/status/DOM changes into listings_history (table exists
-- since 2026_06_04, has never had a trigger -> 0 rows). AFTER UPDATE, WHEN the
-- watched fields actually change, so the scraper's no-op upserts don't write
-- history. Does NOT fire on the enrichment backfill (that never touches price/
-- listing_status/days_on_market). estimated_rent is snapshotted for context.

CREATE OR REPLACE FUNCTION log_listing_history() RETURNS trigger AS $$
BEGIN
  INSERT INTO listings_history (listing_id, observed_at, price, estimated_rent, days_on_market, listing_status)
  VALUES (NEW.id, NOW(), NEW.price, NEW.estimated_rent, NEW.days_on_market, NEW.listing_status);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_listings_history ON listings;
CREATE TRIGGER trg_listings_history
  AFTER UPDATE OF price, listing_status, days_on_market ON listings
  FOR EACH ROW
  WHEN (
    NEW.price          IS DISTINCT FROM OLD.price
    OR NEW.listing_status IS DISTINCT FROM OLD.listing_status
    OR NEW.days_on_market IS DISTINCT FROM OLD.days_on_market
  )
  EXECUTE FUNCTION log_listing_history();

-- Seed a first observation for every currently-priced listing so history has a
-- t0 baseline to diff against (one-time, cheap, no trigger recursion since this
-- is a direct INSERT into the history table).
INSERT INTO listings_history (listing_id, observed_at, price, estimated_rent, days_on_market, listing_status)
SELECT id, created_at, price, estimated_rent, days_on_market, listing_status
FROM listings
WHERE price IS NOT NULL
ON CONFLICT DO NOTHING;
```

**Note:** the seed `INSERT … SELECT` over ~930K rows runs inside the migration's single txn. It is an append to an empty, index-light table — acceptable, but if it proves slow under the runner, move the seed to an OOB batched file and keep only the trigger in the migration. Decide at apply time from the observed duration.

- [ ] **Step 2: Apply + verify capture**

Apply via the runner (or piped psql, as Task 1 Step 3). Then prove the trigger fires:

```bash
ssh root@209.94.61.108 'docker exec infrastructure-postgres-1 psql -U postgres -c "
SELECT count(*) seeded FROM listings_history;
-- force a price change on one row and confirm a history row appears:
WITH one AS (SELECT id, price FROM listings WHERE price IS NOT NULL ORDER BY id LIMIT 1)
UPDATE listings l SET price = one.price + 1 FROM one WHERE l.id = one.id;
"'
ssh root@209.94.61.108 'docker exec infrastructure-postgres-1 psql -U postgres -c "SELECT listing_id, count(*) FROM listings_history GROUP BY 1 ORDER BY count DESC LIMIT 1;"'
```

Expect `seeded` ≈ count of priced listings, and the poked row to now have ≥2 history rows. (Revert the poke: `UPDATE listings SET price = price - 1 WHERE id = <that id>;` — which itself logs another history row; harmless.)

- [ ] **Step 3: Commit**

```bash
git add infrastructure/migrations/2026_07_05_listings_history_trigger.sql
git commit -m "wave1: listings_history trigger + t0 seed (price/status/DOM changes)"
```

---

### Task 6: Deploy scraper, drop dead `status`, final coverage acceptance

**Files:**
- Create: `infrastructure/migrations/2026_07_05_drop_dead_status_column.sql`
- Modify: `services/scraper_service/main.py` (remove `status` from the INSERT)

**Interfaces:**
- Consumes: Tasks 1–5. Produces: the shipped Wave 1 state; the go signal for Wave 4 (investor surfaces).

- [ ] **Step 1: Drop the dead `status` column**

Audit showed `status = 'watch'` for all 940K rows — a scraper artifact, never read meaningfully (`listing_status` is the real field). Remove it from the scraper INSERT (the literal `'watch'` param and the `status` column + its `user_id` neighbor stays), then drop the column.

Create `infrastructure/migrations/2026_07_05_drop_dead_status_column.sql`:

```sql
-- 'status' was 'watch' for 100% of rows (scraper constant, never a real signal).
-- listing_status carries actual state. Drop after the scraper stops writing it.
ALTER TABLE listings DROP COLUMN IF EXISTS status;
```

**Order matters:** deploy the scraper WITHOUT the `status` write (Step 2) BEFORE applying this migration, or the running scraper's INSERT will error on the missing column. Sequence: scraper deploy → migration.

- [ ] **Step 2: Remove `status` from the scraper INSERT**

In `main.py`, delete `status,` from the INSERT column list and the corresponding `'watch',` from the params tuple (the `'watch'` literal at ≈ line 307). Keep `user_id`. Verify placeholder/column counts still match (`python3 -c "import ast; ast.parse(open('services/scraper_service/main.py').read())"`).

- [ ] **Step 3: Full deploy + settle**

```bash
rsync -az --exclude node_modules --exclude .next --exclude .git --exclude .venv --exclude venv --exclude .turbo /Users/johnny/Code/OnePercentRealEstate/ root@209.94.61.108:/opt/onepercent/
ssh root@209.94.61.108 'cd /opt/onepercent && ./infrastructure/deploy.sh build scraper && ./infrastructure/deploy.sh up -d --no-deps scraper'
# then apply the drop-status migration (runner or piped psql)
ssh root@209.94.61.108 'docker exec -i infrastructure-postgres-1 psql -U postgres -v ON_ERROR_STOP=1' < infrastructure/migrations/2026_07_05_drop_dead_status_column.sql
```

- [ ] **Step 4: Acceptance battery**

```bash
ssh root@209.94.61.108 '
echo "=== coverage ==="; docker exec infrastructure-postgres-1 psql -U postgres -c "SELECT * FROM vw_field_coverage;"
echo "=== fresh scrapes populate enrichment (last 30m) ==="; docker exec infrastructure-postgres-1 psql -U postgres -c "SELECT count(*) FILTER (WHERE property_url IS NOT NULL) url, count(*) FILTER (WHERE hoa_fee IS NOT NULL) hoa FROM listings WHERE updated_at > now() - interval '"'"'30 min'"'"';"
echo "=== history accruing ==="; docker exec infrastructure-postgres-1 psql -U postgres -c "SELECT count(*) rows, count(DISTINCT listing_id) listings FROM listings_history;"
echo "=== scraper healthy, no status errors ==="; docker logs infrastructure-scraper-1 --since 10m 2>&1 | grep -ciE "error|status.*does not exist" 
echo "=== apps still up ==="; curl -s -o /dev/null -w "app:%{http_code}\n" http://localhost:3001/api/healthz
'
```

Pass: `vw_field_coverage` shows `unenriched_rows=0` + real `pct_*`; fresh scrapes populate url/hoa; `listings_history` growing; scraper error count 0; app 200.

- [ ] **Step 5: Commit, update memory, finish**

```bash
git add infrastructure/migrations/2026_07_05_drop_dead_status_column.sql services/scraper_service/main.py docs/superpowers/plans/2026-07-05-wave-1-baseline.md
git commit -m "wave1: drop dead status column + final coverage acceptance"
```

Update `wave-progress` + `upgrade-plan` memory: Wave 1 shipped (coverage numbers), `extra_property_data` decision, external sources (Census/FEMA) deferred to Wave 1b. Then use superpowers:finishing-a-development-branch.

---

## Scope decision: external sources → Wave 1b (separate plan)

The spec's Wave 1 also lists Census ACS demographics, FEMA flood zones, and FRED
mortgage rate. Those are **independent subsystems** (new external fetchers, new
tables, their own rate-limit + failure modes) and don't share code with the
harvest above. Bundling them would make this plan un-shippable as a unit. They
get their own plan (`wave-1b-external-sources`) after this core harvest lands.
FRED specifically is already owned by Wave 3 (live rate into underwriting, gated
on the FRED key) — it should not be duplicated here.

## Self-review notes

- **Spec coverage:** Wave1 items — scraper extraction (Task 2), extra_property_data w/ cost measurement (Task 3), backfill-from-raw_data no-rescrape (Task 4), listings_history trigger (Task 5), drop `status` + coverage VIEW (Tasks 1+6), estimated_rent=0→NULL (explicitly Wave 2 per spec, not here). External sources (Census/FEMA/FRED) → scoped to Wave 1b with rationale.
- **Rent-safety** is the highest-risk interaction: Task 1 Step 1 verifies the rent trigger's fire condition before any write; Task 4 mirrors the proven sale_type backfill (no rent columns, no updated_at). If Task 1 Step 1 finds the trigger fires on unqualified UPDATE, STOP and reassess before running Task 4.
- **Riskiest edit** is the Task 2 INSERT (positional-param count). Guarded by the one-ZIP integration check (Step 6) which fails loudly on a count mismatch.
- **No placeholders** except the two explicit owner/measurement decisions (Task 3 outcome, Task 5 seed-in-migration-vs-OOB) — both are genuine runtime forks with both branches specified.
