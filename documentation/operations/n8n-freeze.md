# n8n Crawl Freeze — Runbook

**Audited 2026-07-05 (Wave 0, Task 7).**

## What n8n actually runs

`docker exec infrastructure-n8n-1 n8n list:workflow` returns three workflows:

| ID | Name | Active? | Role |
|---|---|---|---|
| `r31g9HwLPPjrE8pO` | ZIP Iterator — every 30s, cycle all ZIPs | **ACTIVE** | **Seeds `crawl_jobs`** — one enqueue every 30 s (≈2,880 jobs/day, matches observed) |
| `OvL9tZVsCfzDbRqY` | ZIP Iterator — every 30s, cycle all ZIPs | inactive | Duplicate of the above (candidate for deletion at Wave 8) |
| `4vCFaaKUohstcRtu` | US Real Estate Scraper - Sales + Rentals | inactive | Legacy full-scrape flow; superseded by `apps/worker` crawl.ts |

**n8n is the crawl-queue seeder.** The `apps/worker` crawl worker *drains* `crawl_jobs`
(claims + runs scrapes); n8n's ZIP iterator is what *fills* it. Freezing the iterator halts
new crawl ingestion but does not stop the worker from finishing already-queued jobs.

## Policy (deviation from the spec, deliberate)

The spec said "disable n8n for the duration of Waves 0–3." Audit shows that would halt the
platform's healthy ingestion for weeks. **Instead: freeze only during sensitive windows** —
Wave 1's `raw_data` backfill + column-add deploys, or any diagnosis needing a quiescent
`listings` table — and re-enable immediately after. Full decommission decision is deferred to
Wave 8 (the worker owns crawl; the iterator may be replaceable by a `pg_cron` enqueue).

## Freeze (disable seeding)

```bash
ssh root@209.94.61.108
docker exec infrastructure-n8n-1 n8n update:workflow --id r31g9HwLPPjrE8pO --active=false
docker restart infrastructure-n8n-1   # activation state applies on restart
```

Verify seeding stopped (wait ~100 s, expect the count to hold flat):

```bash
docker exec infrastructure-postgres-1 psql -U postgres -t -A \
  -c "SELECT count(*) FROM crawl_jobs;"
# ...wait 100s, run again — delta should be ~0
```

## Unfreeze (resume seeding)

```bash
docker exec infrastructure-n8n-1 n8n update:workflow --id r31g9HwLPPjrE8pO --active=true
docker restart infrastructure-n8n-1
docker exec infrastructure-n8n-1 n8n list:workflow --active=true   # r31g9HwLPPjrE8pO present
```

## Tested

2026-07-05: froze `r31g9HwLPPjrE8pO`, confirmed `crawl_jobs` held flat over 100 s
(delta 1 vs the normal ≈3.3/100 s), re-enabled, confirmed it returned to the active list.
Switch works as documented.
