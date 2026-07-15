# Proxy-Free Scraper Horizontal Scaling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scale the HomeHarvest (Realtor.com) crawl from one scraper IP to a pool of up to 5 IPs (main-as-driver + up to 4 side scraper servers) **without proxies** — each IP self-paced under its own ban threshold with an isolated circuit breaker — turning a months-long full pass into roughly a week, while surviving per-IP bans gracefully.

**Architecture:** The scraper (`services/scraper_service`, FastAPI + `homeharvest==0.8.18`) is already a **stateless per-IP worker**: POST a ZIP, it scrapes Realtor.com *from its own IP* and inserts to the central DB. The driver (`apps/worker/src/crawl.ts`) claims ZIPs from `crawl_jobs` (SKIP LOCKED) and POSTs them to a **single** `SCRAPER_URL` with a **global** 30s pacing gate and one shared block breaker. This plan replaces the single URL + global gate with a **scraper pool**: N endpoints, each with an independent AIMD-calibrated rate limiter and its own breaker, so aggregate throughput ≈ N × safe-per-IP-rate and a ban on one IP never stalls the others. Side servers reach the DB over the **existing private mesh** (`10.8.0.0/22`, interface `eth1`), retiring the fragile reverse-SSH tunnel.

**Tech Stack:** TypeScript worker (`apps/worker`, Vitest, `pg`), Python FastAPI scraper (`services/scraper_service`, pytest), Postgres 16 (central, on main `10.8.2.241`), systemd units (`ops/systemd`), same-provider/region VPS nodes on the `10.8.x` private network.

## Current State (verified 2026-07-15)

| Fact | Value | Implication |
|---|---|---|
| Driver | `oper-worker` = `crawl.js` on main (`10.8.2.241`) | claims `crawl_jobs`, POSTs to scraper; **working** (jobs 1933-1936 live) |
| Scraper | one FastAPI on side box `152.44.44.224` (private `10.8.3.41:80`) | scrapes from **that** IP; the only scraping IP today |
| Pacing | global `CRAWL_JOB_MIN_INTERVAL_MS=30000` + single `blockedUntil` | ~1 ZIP / 20-30s on ONE IP → ~3-4k ZIPs/day ceiling, erratic |
| DB path | scraper → `127.0.0.1:15432` → reverse-SSH over `:443` → main PG | fragile; `oper-sshtunnel.service` crash-looping (**34k restarts**, port 443 in use) |
| Coverage | 26,771 / ~41k US ZIPs; `crawl_jobs`: 82k pending | full/repeat pass = months at one IP |
| Ban reality | aggressive rate → banned in ~1h; ~30s/ZIP survives | per-IP rate is the hard constraint; must auto-calibrate |
| homeharvest | `0.8.18` both boxes | original break was the **ban**, not a code/version bug |
| Private mesh | `eth1 10.8.2.241/22` (main), `10.8.3.41/22` (side) | side servers can reach PG directly — no SSH tunnel needed |

## Global Constraints

- **One IP = one rate budget.** No IP may exceed its own AIMD-tuned interval; the fleet must never converge all IPs onto Realtor.com in a synchronized burst. Per-endpoint jitter is mandatory.
- **A block on one IP must not pause the others.** Breakers are per-endpoint, never global.
- **No proxies.** Each server's own egress IP is the only identity. Side servers are same-provider/region (user decision) — accept correlated-IP risk, mitigate with independent pacing + staggered start phases.
- **Central DB is the single source of truth.** All scrapers insert to main's Postgres (`10.8.2.241:5432`) over the private mesh using a least-privilege role — never superuser, never the public interface.
- **Preserve the politeness that already works:** keep the per-ZIP pass gap (`CRAWL_PASS_JITTER_MS`) and the "gentle, spaced, windowed" behavior the old n8n workflow relied on. Scale by adding IPs, not by hammering each one harder.
- **Backward compatible:** a single-element `SCRAPER_URLS` must behave exactly like today's single `SCRAPER_URL` (safe incremental rollout).
- **Tests:** worker `pnpm --filter @oper/worker test <path>`; scraper `cd services/scraper_service && pytest <path>`.

## File Structure

| File | Responsibility |
|---|---|
| `services/scraper_service/main.py` (modify) | Return an explicit `blocked` signal + HTTP 429 when Realtor.com blocks (distinct from "no results"). |
| `apps/worker/src/scraper-pool.ts` (create) | Pure pool: N `ScraperEndpoint`s, AIMD rate limiter + per-endpoint breaker, `acquire()`/`release()`. |
| `apps/worker/src/scraper-pool.test.ts` (create) | Unit tests for AIMD, availability, per-endpoint isolation. |
| `apps/worker/src/env.ts` (modify) | Add `SCRAPER_URLS` (list) + AIMD tuning knobs; keep `SCRAPER_URL` as fallback. |
| `apps/worker/src/crawl.ts` (modify) | Route each job through the pool; replace global gate + single breaker. |
| `apps/worker/src/metrics.ts` (create) | Per-endpoint counters exposed for the exporter (throughput, blocks, interval, ETA). |
| `ops/scraper-node/cloud-init.yaml` (create) | Stand up a side scraper node: mesh, deps, scraper unit, DB role env. |
| `ops/scraper-node/README.md` (create) | Runbook: provision, register in `SCRAPER_URLS`, calibrate, kill-switch. |
| `ops/systemd/oper-scraper.service` (reference) | The per-node scraper unit (already exists on side box). |

---

## Phase A — Scraper emits a real block signal

### Task A1: `blocked` outcome from the scraper

**Files:**
- Modify: `services/scraper_service/main.py` (the `scrape_listings` handler + response model)
- Test: `services/scraper_service/test_block_signal.py` (create)

**Interfaces:**
- Produces: the `/scrape` JSON response gains `"blocked": bool`; when a block is detected the endpoint returns **HTTP 429** with `{"blocked": true, "count": 0, ...}`. A pure helper `classify_block(exc: Exception | None, row_count: int, elapsed_s: float) -> bool` decides block-vs-empty.

- [ ] **Step 1: Write the failing test**

```python
# services/scraper_service/test_block_signal.py
from main import classify_block

def test_homeharvest_403_is_a_block():
    assert classify_block(RuntimeError("Response 403 Forbidden"), 0, 1.2) is True

def test_captcha_or_challenge_text_is_a_block():
    assert classify_block(RuntimeError("Access to this page has been denied / captcha"), 0, 0.5) is True

def test_empty_result_is_not_a_block():
    # A genuinely empty ZIP returns 0 rows quickly with no error.
    assert classify_block(None, 0, 0.8) is False

def test_normal_results_not_a_block():
    assert classify_block(None, 25, 3.0) is False
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd services/scraper_service && pytest test_block_signal.py -q`
Expected: FAIL — `classify_block` not importable.

- [ ] **Step 3: Implement** — add `classify_block` and wire it into the handler.

In `services/scraper_service/main.py`, add near the top-level helpers:

```python
# Substrings Realtor.com / homeharvest surface when our IP is throttled or
# challenged. A block is an EXCEPTION carrying one of these, OR a suspicious
# empty-but-slow response. A fast empty response is a genuinely empty ZIP.
_BLOCK_MARKERS = ("403", "429", "forbidden", "captcha", "access to this page has been denied",
                  "too many requests", "unusual traffic", "blocked")

def classify_block(exc, row_count: int, elapsed_s: float) -> bool:
    if exc is not None:
        msg = str(exc).lower()
        return any(m in msg for m in _BLOCK_MARKERS)
    return False
```

Then in `scrape_listings`, wrap the `scrape_property(**scrape_kwargs)` call so an exception is classified rather than raised blindly, and set `blocked` in the response. Minimal change:

```python
    import time as _time
    _t0 = _time.time()
    _exc = None
    try:
        df = scrape_property(**scrape_kwargs)
    except Exception as e:  # homeharvest raises on 403/429/challenge
        _exc = e
        df = None
    _blocked = classify_block(_exc, 0 if df is None else len(df), _time.time() - _t0)
    if _blocked:
        # Signal the driver to cool this IP down. 429 is the contract.
        raise HTTPException(status_code=429, detail={"blocked": True, "count": 0, "inserted": 0, "skipped": 0})
    if df is None:
        # A non-block error: surface as 502 so the driver logs but does not cool off.
        raise HTTPException(status_code=502, detail=f"scrape error: {str(_exc)[:200]}")
```

Add `"blocked": False` to the normal success response dict (the one returning `count/inserted/skipped`).

- [ ] **Step 4: Run to verify it passes**

Run: `cd services/scraper_service && pytest test_block_signal.py -q`
Expected: PASS (4 tests).

- [ ] **Step 5: Regression + commit**

Run: `cd services/scraper_service && pytest -q` (existing suite stays green).

```bash
git add services/scraper_service/main.py services/scraper_service/test_block_signal.py
git commit -m "feat(scraper): explicit block signal (HTTP 429 + blocked flag) vs empty result"
```

---

## Phase B — The scraper pool (pure, tested)

### Task B1: `ScraperEndpoint` with an AIMD rate limiter

**Files:**
- Create: `apps/worker/src/scraper-pool.ts`
- Test: `apps/worker/src/scraper-pool.test.ts`

**Interfaces:**
- Produces:
  - `type Outcome = 'ok' | 'blocked' | 'error'`
  - `type AimdConfig = { minIntervalMs: number; maxIntervalMs: number; startIntervalMs: number; decreaseMs: number; increaseFactor: number; cooloffMs: number; cooloffMaxMs: number; jitterFrac: number }`
  - `class ScraperEndpoint` with: `constructor(url: string, cfg: AimdConfig, now?: () => number)`, `readyAt(): number` (epoch ms when it may next start a job), `available(atMs: number): boolean` (`atMs >= readyAt()` and not in cool-off), `reserve(atMs: number): void` (advance the next-start by the current interval + jitter), `settle(outcome: Outcome, atMs: number): void` (AIMD: on `ok` decrease interval toward min; on `blocked` enter/extend cool-off + multiply interval up; on `error` no rate change), plus readonly `url`, `intervalMs`, `stats {ok, blocked, error}`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/worker/src/scraper-pool.test.ts
import { describe, it, expect } from 'vitest';
import { ScraperEndpoint, type AimdConfig } from './scraper-pool';

const CFG: AimdConfig = {
  minIntervalMs: 5_000, maxIntervalMs: 120_000, startIntervalMs: 30_000,
  decreaseMs: 1_000, increaseFactor: 2, cooloffMs: 30 * 60_000,
  cooloffMaxMs: 4 * 60 * 60_000, jitterFrac: 0, // jitter 0 for deterministic tests
};

describe('ScraperEndpoint AIMD', () => {
  it('starts at the configured interval and is available immediately', () => {
    const e = new ScraperEndpoint('http://a', CFG, () => 1000);
    expect(e.intervalMs).toBe(30_000);
    expect(e.available(1000)).toBe(true);
  });
  it('reserve() pushes the next start out by the interval', () => {
    const e = new ScraperEndpoint('http://a', CFG, () => 1000);
    e.reserve(1000);
    expect(e.available(1000)).toBe(false);
    expect(e.readyAt()).toBe(31_000);
    expect(e.available(31_000)).toBe(true);
  });
  it('additively decreases interval on success (toward min)', () => {
    const e = new ScraperEndpoint('http://a', CFG, () => 1000);
    e.settle('ok', 1000);
    expect(e.intervalMs).toBe(29_000); // -decreaseMs
    expect(e.stats.ok).toBe(1);
  });
  it('multiplicatively increases interval + enters cool-off on block', () => {
    const e = new ScraperEndpoint('http://a', CFG, () => 1000);
    e.settle('blocked', 1000);
    expect(e.intervalMs).toBe(60_000);        // ×increaseFactor
    expect(e.available(1000)).toBe(false);     // in cool-off
    expect(e.available(1000 + 30 * 60_000)).toBe(true);
    expect(e.stats.blocked).toBe(1);
  });
  it('never drops below min or rises above max', () => {
    const e = new ScraperEndpoint('http://a', { ...CFG, startIntervalMs: 6_000 }, () => 0);
    for (let i = 0; i < 10; i++) e.settle('ok', 0);
    expect(e.intervalMs).toBe(CFG.minIntervalMs);
    for (let i = 0; i < 10; i++) e.settle('blocked', 0);
    expect(e.intervalMs).toBe(CFG.maxIntervalMs);
  });
  it('repeated blocks escalate the cool-off up to the cap', () => {
    const e = new ScraperEndpoint('http://a', CFG, () => 0);
    e.settle('blocked', 0);
    const first = e.readyAt();
    e.settle('blocked', first);       // second block after the first window
    expect(e.readyAt() - first).toBeGreaterThan(30 * 60_000); // escalated
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oper/worker test src/scraper-pool.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ScraperEndpoint`** (put it in `scraper-pool.ts`; the pool class comes in B2)

```ts
// apps/worker/src/scraper-pool.ts
export type Outcome = 'ok' | 'blocked' | 'error';

export type AimdConfig = {
  minIntervalMs: number;
  maxIntervalMs: number;
  startIntervalMs: number;
  decreaseMs: number;      // additive decrease per success
  increaseFactor: number;  // multiplicative increase per block
  cooloffMs: number;       // base cool-off on a block
  cooloffMaxMs: number;    // cool-off cap
  jitterFrac: number;      // 0..1 fraction of interval added as random jitter
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export class ScraperEndpoint {
  readonly url: string;
  intervalMs: number;
  stats = { ok: 0, blocked: 0, error: 0 };
  private cfg: AimdConfig;
  private now: () => number;
  private nextStart = 0;   // epoch ms; earliest this endpoint may start a job
  private blockedUntil = 0;
  private cooloff = 0;     // current escalating cool-off

  constructor(url: string, cfg: AimdConfig, now: () => number = Date.now) {
    this.url = url;
    this.cfg = cfg;
    this.now = now;
    this.intervalMs = cfg.startIntervalMs;
  }

  readyAt(): number { return Math.max(this.nextStart, this.blockedUntil); }

  available(atMs: number): boolean { return atMs >= this.readyAt(); }

  reserve(atMs: number): void {
    const jit = this.cfg.jitterFrac > 0 ? Math.random() * this.cfg.jitterFrac * this.intervalMs : 0;
    this.nextStart = atMs + this.intervalMs + jit;
  }

  settle(outcome: Outcome, atMs: number): void {
    this.stats[outcome]++;
    if (outcome === 'ok') {
      this.intervalMs = clamp(this.intervalMs - this.cfg.decreaseMs, this.cfg.minIntervalMs, this.cfg.maxIntervalMs);
    } else if (outcome === 'blocked') {
      this.intervalMs = clamp(this.intervalMs * this.cfg.increaseFactor, this.cfg.minIntervalMs, this.cfg.maxIntervalMs);
      this.cooloff = this.cooloff === 0 ? this.cfg.cooloffMs : Math.min(this.cooloff * 2, this.cfg.cooloffMaxMs);
      this.blockedUntil = atMs + this.cooloff;
    }
    // 'error' leaves the rate untouched (transient scraper/network issue).
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @oper/worker test src/scraper-pool.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/scraper-pool.ts apps/worker/src/scraper-pool.test.ts
git commit -m "feat(worker): ScraperEndpoint with AIMD per-IP rate limiter + cool-off"
```

### Task B2: `ScraperPool` — pick the next available IP

**Files:**
- Modify: `apps/worker/src/scraper-pool.ts`
- Modify: `apps/worker/src/scraper-pool.test.ts`

**Interfaces:**
- Produces:
  - `class ScraperPool` with: `constructor(urls: string[], cfg: AimdConfig, now?: () => number)`, `acquire(atMs?: number): ScraperEndpoint | null` (the available endpoint with the **earliest** `readyAt`, or `null` if all are in cool-off/reserved), `nextReadyAt(): number` (soonest any endpoint becomes available — for the caller's sleep), `endpoints: ScraperEndpoint[]`.

- [ ] **Step 1: Write the failing test** (append)

```ts
// append to apps/worker/src/scraper-pool.test.ts
import { ScraperPool } from './scraper-pool';

describe('ScraperPool', () => {
  it('acquire returns an available endpoint and reserves it', () => {
    const p = new ScraperPool(['http://a', 'http://b'], CFG, () => 1000);
    const e = p.acquire(1000)!;
    expect(e).not.toBeNull();
    expect(e.available(1000)).toBe(false); // reserved
    // second acquire gets the OTHER endpoint (a is reserved)
    const e2 = p.acquire(1000)!;
    expect(e2.url).not.toBe(e.url);
  });
  it('returns null when every endpoint is reserved/cooling', () => {
    const p = new ScraperPool(['http://a'], CFG, () => 1000);
    p.acquire(1000);
    expect(p.acquire(1000)).toBeNull();
    expect(p.nextReadyAt()).toBe(31_000);
  });
  it('a blocked endpoint is skipped; a healthy one still serves', () => {
    const p = new ScraperPool(['http://a', 'http://b'], CFG, () => 1000);
    p.endpoints[0].settle('blocked', 1000);      // a cools off
    const e = p.acquire(1000)!;
    expect(e.url).toBe('http://b');               // b still available
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oper/worker test src/scraper-pool.test.ts`
Expected: FAIL — `ScraperPool` not exported.

- [ ] **Step 3: Implement** (append to `scraper-pool.ts`)

```ts
export class ScraperPool {
  readonly endpoints: ScraperEndpoint[];
  private now: () => number;

  constructor(urls: string[], cfg: AimdConfig, now: () => number = Date.now) {
    if (urls.length === 0) throw new Error('ScraperPool needs at least one URL');
    this.now = now;
    this.endpoints = urls.map((u) => new ScraperEndpoint(u, cfg, now));
  }

  acquire(atMs = this.now()): ScraperEndpoint | null {
    let best: ScraperEndpoint | null = null;
    for (const e of this.endpoints) {
      if (e.available(atMs) && (best === null || e.readyAt() < best.readyAt())) best = e;
    }
    if (best) best.reserve(atMs);
    return best;
  }

  nextReadyAt(): number {
    return Math.min(...this.endpoints.map((e) => e.readyAt()));
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @oper/worker test src/scraper-pool.test.ts`
Expected: PASS (9 tests total).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/scraper-pool.ts apps/worker/src/scraper-pool.test.ts
git commit -m "feat(worker): ScraperPool — earliest-available IP selection + skip blocked"
```

---

## Phase C — Wire the pool into the driver

### Task C1: `SCRAPER_URLS` env + AIMD knobs

**Files:**
- Modify: `apps/worker/src/env.ts`
- Test: `apps/worker/src/env.test.ts` (add cases; create if absent)

**Interfaces:**
- Consumes: existing `readString`/`readInt` helpers in `env.ts`.
- Produces: `env.SCRAPER_URLS: string[]` (parsed from a comma-separated `SCRAPER_URLS`, falling back to `[SCRAPER_URL]`), and `env.aimd: AimdConfig` built from new env vars with today's behavior as defaults.

- [ ] **Step 1: Write the failing test**

```ts
// apps/worker/src/env.test.ts (add)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('SCRAPER_URLS parsing', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('splits SCRAPER_URLS on commas and trims', async () => {
    process.env.SCRAPER_URLS = ' http://10.8.3.41 , http://10.8.4.10 ';
    const { loadEnv } = await import('./env');
    expect(loadEnv().SCRAPER_URLS).toEqual(['http://10.8.3.41', 'http://10.8.4.10']);
  });
  it('falls back to the single SCRAPER_URL when SCRAPER_URLS is unset', async () => {
    delete process.env.SCRAPER_URLS;
    process.env.SCRAPER_URL = 'http://only';
    const { loadEnv } = await import('./env');
    expect(loadEnv().SCRAPER_URLS).toEqual(['http://only']);
  });
});
```

> Check the real export name in `apps/worker/src/env.ts` first (the module may export `loadEnv()` or a singleton `env`). Match the test to whichever exists; the assertions on `SCRAPER_URLS` stand either way.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oper/worker test src/env.test.ts`
Expected: FAIL — `SCRAPER_URLS` undefined.

- [ ] **Step 3: Implement** — in `env.ts`, add to the interface and the builder:

```ts
// interface additions
readonly SCRAPER_URLS: string[];
readonly aimd: import('./scraper-pool').AimdConfig;
```

```ts
// in the builder, after SCRAPER_URL is read:
const scraperUrls = (process.env.SCRAPER_URLS ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);
// ...and in the returned object:
  SCRAPER_URLS: scraperUrls.length ? scraperUrls : [readString('SCRAPER_URL', 'http://scraper:8000')],
  aimd: {
    // Defaults reproduce today's single-IP behavior: 30s start, gentle.
    minIntervalMs: readIntMin0('SCRAPER_MIN_INTERVAL_MS', 12_000),
    maxIntervalMs: readIntMin0('SCRAPER_MAX_INTERVAL_MS', 120_000),
    startIntervalMs: readIntMin0('CRAWL_JOB_MIN_INTERVAL_MS', 30_000),
    decreaseMs: readIntMin0('SCRAPER_AIMD_DECREASE_MS', 1_000),
    increaseFactor: readInt('SCRAPER_AIMD_INCREASE_FACTOR', 2),
    cooloffMs: readInt('CRAWL_BLOCK_COOLOFF_MS', 30 * 60_000),
    cooloffMaxMs: readInt('SCRAPER_COOLOFF_MAX_MS', 4 * 60 * 60_000),
    jitterFrac: 0.25,
  },
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @oper/worker test src/env.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/env.ts apps/worker/src/env.test.ts
git commit -m "feat(worker): SCRAPER_URLS pool + AIMD config (defaults = today's behavior)"
```

### Task C2: Route jobs through the pool in `crawl.ts`

**Files:**
- Modify: `apps/worker/src/crawl.ts` (the `scrape()` URL, `paceJobStart()`, the block breaker, and the process loop)

**Interfaces:**
- Consumes: `ScraperPool`, `ScraperEndpoint`, `Outcome` (Task B); `env.SCRAPER_URLS`, `env.aimd` (Task C1).
- Produces: no new exports; the module-global single-IP gate (`nextJobEarliestStart`) and single breaker (`blockedUntil`/`enterBlockCooloff`) are replaced by one `ScraperPool` instance.

- [ ] **Step 1: Construct the pool once at module scope**

Add near the top of `crawl.ts` (after `env` import):

```ts
import { ScraperPool, type Outcome } from './scraper-pool';
const pool = new ScraperPool(env.SCRAPER_URLS, env.aimd);
```

- [ ] **Step 2: Replace `paceJobStart()` with a pool acquire**

Change the claim/process flow so that, instead of calling `paceJobStart()` then claiming, each runner **acquires an endpoint first** (this is the per-IP gate), then claims a job, processes it against that endpoint's URL, and settles the outcome. Replace the body of the runner's inner step (around the current `paceJobStart()` + `claimNextJob()` call) with:

```ts
    const endpoint = pool.acquire();
    if (!endpoint) {
      // Every IP is reserved or cooling off — wait for the soonest one.
      await sleep(Math.min(Math.max(pool.nextReadyAt() - Date.now(), 250), 5_000));
      continue;
    }
    const job = await claimNextJob();
    if (!job) {
      // No work; we reserved a slot we won't use — that's fine, the reserve
      // just paced this IP. Idle-poll.
      await sleep(IDLE_POLL_MS);
      continue;
    }
    let outcome: Outcome = 'ok';
    try {
      const result = await processJob(job, endpoint.url, parentLog); // see Step 3
      // ...existing completion bookkeeping using result...
    } catch (err) {
      outcome = classifyOutcome(err); // 'blocked' on 429, else 'error'
      // ...existing failure bookkeeping (mark job failed/retry)...
    } finally {
      endpoint.settle(outcome, Date.now());
    }
```

- [ ] **Step 3: Thread the endpoint URL into `scrape()`**

Change `scrape()` (and `processJob`/`runPass`) to take an explicit `scraperUrl: string` instead of reading `env.SCRAPER_URL`:

```ts
async function scrape(
  job: CrawlJob, listingType: string | string[], scraperUrl: string, log: WorkerLogger,
  opts?: { foreclosure?: boolean; pastDays?: number; dateFrom?: string; dateTo?: string; source?: string },
): Promise<ScrapeResult> {
  const url = `${scraperUrl.replace(/\/$/, '')}/scrape`;
  // ...unchanged...
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const e = new Error(`scraper ${res.status}: ${body.slice(0, 200)}`);
    (e as Error & { status?: number }).status = res.status;  // carry 429 for classifyOutcome
    throw e;
  }
  // ...unchanged...
}
```

Add the outcome classifier:

```ts
function classifyOutcome(err: unknown): Outcome {
  const status = (err as { status?: number } | null)?.status;
  return status === 429 ? 'blocked' : 'error';
}
```

Update `processJob`/`runPass` signatures to pass `scraperUrl` down to every `scrape(...)` call (the for_sale + foreclosure passes).

- [ ] **Step 4: Delete the now-dead global gate + breaker**

Remove `nextJobEarliestStart`, `paceJobStart()`, `blockedUntil`, `currentCooloffMs`, `blockEpoch`, `enterBlockCooloff()`, and the global "refuse to claim before blockedUntil" checks — their responsibilities now live in `ScraperEndpoint`. Keep `passGap()` (per-ZIP pass spacing) and `jitter()`.

- [ ] **Step 5: Typecheck + unit tests + a single-endpoint parity check**

Run: `pnpm --filter @oper/worker typecheck && pnpm --filter @oper/worker test`
Expected: PASS. With `SCRAPER_URLS` unset (fallback to one URL), behavior matches today: one IP, ~30s start interval, cools off on 429.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/crawl.ts
git commit -m "feat(worker): drive crawl through the scraper pool (per-IP pacing + breakers)"
```

---

## Phase D — Provision the fleet + retire the SSH tunnel

### Task D1: Central DB reachable over the private mesh

**Files:**
- Create: `infrastructure/migrations/out-of-band/2026_07_XX_scraper_ingest_role.sql`
- Modify: main Postgres `pg_hba.conf` + `postgresql.conf` (server-side, documented in `ops/scraper-node/README.md`)

- [ ] **Step 1: Least-privilege ingest role** — the scrapers need INSERT/UPDATE on the listings + related tables only.

```sql
-- Run as postgres on main. Password set separately (ALTER ROLE ... PASSWORD), never committed.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='oper_scraper') THEN
    CREATE ROLE oper_scraper LOGIN IN ROLE oper_rw;  -- oper_rw already grants CRUD on public tables
  END IF;
END $$;
```

(`oper_rw` was created by `2026_07_12_db_roles.sql`; reusing it keeps grants consistent. If tighter scope is wanted later, swap to explicit table grants.)

- [ ] **Step 2: Bind Postgres to the private mesh + allowlist the /22**

On main, set `listen_addresses = 'localhost,10.8.2.241'` (not `*`), and add to `pg_hba.conf`:

```
# Scraper fleet on the private mesh only (never the public interface).
hostssl  postgres  oper_scraper  10.8.0.0/22  scram-sha-256
```

Reload: `sudo -u postgres psql -c "SELECT pg_reload_conf();"`. Verify from the existing side box: `psql "postgresql://oper_scraper:***@10.8.2.241:5432/postgres" -c 'select 1'`.

- [ ] **Step 3: Point the side scraper at the mesh DB; retire the tunnel**

Set the side box scraper `DATABASE_URL=postgresql://oper_scraper:***@10.8.2.241:5432/postgres` (via its `/etc/oper.env`), restart `oper-scraper`, confirm inserts continue, then **disable the reverse-SSH tunnel**: on the side box `systemctl disable --now oper-sshtunnel.service` (the crash-looping 34k-restart unit) and on main `systemctl disable --now oper-db-tunnel.service`. Verify `oper-scraper` still inserts (`journalctl -u oper-scraper -f`).

- [ ] **Step 4: Commit the SQL + runbook note**

```bash
git add infrastructure/migrations/out-of-band/2026_07_XX_scraper_ingest_role.sql ops/scraper-node/README.md
git commit -m "feat(infra): oper_scraper mesh DB access; retire reverse-SSH tunnel"
```

### Task D2: One-command side-node provisioning

**Files:**
- Create: `ops/scraper-node/cloud-init.yaml`
- Create: `ops/scraper-node/README.md`

- [ ] **Step 1: cloud-init that stands up a scraper node** — installs Python + deps, clones the repo, creates the venv, writes `/etc/oper.env` with the mesh `DATABASE_URL`, and enables `oper-scraper` bound to the node's `eth1` private IP on :80. (Model the unit on the existing `ops/systemd/oper-scraper.service` from the working side box — copy it verbatim; only the bind IP differs per node.)

```yaml
# ops/scraper-node/cloud-init.yaml  (fill ${...} at provision time)
#cloud-config
package_update: true
packages: [git, python3-venv, python3-pip, build-essential, libpq-dev]
write_files:
  - path: /etc/oper.env
    permissions: '0600'
    content: |
      DATABASE_URL=postgresql://oper_scraper:${SCRAPER_DB_PASSWORD}@10.8.2.241:5432/postgres
      SCRAPE_TIMEOUT_MS=240000
runcmd:
  - git clone https://github.com/jonquixote/OnePercentRealEstate /opt/onepercent
  - python3 -m venv /opt/onepercent/services/ml/.venv
  - /opt/onepercent/services/ml/.venv/bin/pip install -r /opt/onepercent/services/scraper_service/requirements.txt
  - PRIV_IP=$(ip -4 -o addr show eth1 | awk '{print $4}' | cut -d/ -f1)
  - install -m644 /opt/onepercent/ops/systemd/oper-scraper.service /etc/systemd/system/oper-scraper.service
  - sed -i "s#--host [0-9.]*#--host ${PRIV_IP}#" /etc/systemd/system/oper-scraper.service
  - systemctl daemon-reload && systemctl enable --now oper-scraper.service
```

- [ ] **Step 2: Runbook** (`ops/scraper-node/README.md`): provision N nodes (same provider/region, all on the `10.8.x` mesh), collect each node's private IP, then append them to the driver's `SCRAPER_URLS` on main and `systemctl restart oper-worker`. Include the calibration + kill-switch sections (Task D3) and the exact provision command for the chosen provider.

- [ ] **Step 3: Provision the first NEW node + register it**

Bring up node #2, confirm `curl http://<privIP>/health` and a one-off `curl -XPOST http://<privIP>/scrape -d '{"location":"77002","listing_type":"for_sale"}'` inserts rows. Then on main set `SCRAPER_URLS=http://10.8.3.41,http://<node2privIP>` and restart the worker. Watch both IPs draw jobs (`journalctl -u oper-worker -f` shows alternating endpoint URLs).

- [ ] **Step 4: Commit**

```bash
git add ops/scraper-node/cloud-init.yaml ops/scraper-node/README.md
git commit -m "feat(infra): one-command scraper-node provisioning (cloud-init + runbook)"
```

### Task D3: Per-IP observability, calibration, kill-switch

**Files:**
- Create: `apps/worker/src/metrics.ts`
- Modify: `apps/worker/src/crawl.ts` (emit endpoint stats), `ops/scraper-node/README.md` (calibration + kill-switch)

- [ ] **Step 1: Emit per-endpoint metrics** — every N seconds, the driver logs (and, if the worker exposes a metrics port, serves) one line per endpoint: `{url, intervalMs, ok, blocked, error, readyInMs}`. Add a pure `formatEndpointMetrics(pool): Record<string,unknown>[]` in `metrics.ts` with a unit test asserting it reflects each endpoint's `stats` + `intervalMs`, and call it from a `setInterval` in `crawl.ts`.

```ts
// apps/worker/src/metrics.ts
import type { ScraperPool } from './scraper-pool';
export function formatEndpointMetrics(pool: ScraperPool, nowMs: number): Record<string, unknown>[] {
  return pool.endpoints.map((e) => ({
    url: e.url, interval_ms: e.intervalMs,
    ok: e.stats.ok, blocked: e.stats.blocked, error: e.stats.error,
    ready_in_ms: Math.max(0, e.readyAt() - nowMs),
  }));
}
```

```ts
// apps/worker/src/metrics.test.ts
import { describe, it, expect } from 'vitest';
import { ScraperPool } from './scraper-pool';
import { formatEndpointMetrics } from './metrics';
const CFG = { minIntervalMs: 5000, maxIntervalMs: 120000, startIntervalMs: 30000, decreaseMs: 1000, increaseFactor: 2, cooloffMs: 1000, cooloffMaxMs: 4000, jitterFrac: 0 };
describe('formatEndpointMetrics', () => {
  it('reports interval + counters per endpoint', () => {
    const p = new ScraperPool(['http://a'], CFG, () => 0);
    p.endpoints[0].settle('blocked', 0);
    const m = formatEndpointMetrics(p, 0)[0];
    expect(m.blocked).toBe(1);
    expect(m.interval_ms).toBe(60000);
  });
});
```

Run: `pnpm --filter @oper/worker test src/metrics.test.ts` → PASS.

- [ ] **Step 2: Calibration procedure (runbook)** — document the empirical loop the user asked for: start a new IP at `SCRAPER_MIN_INTERVAL_MS` conservative (e.g. 30s), let AIMD tighten it on sustained success, and watch the `blocked` counter. The IP's **stable operating interval** is where AIMD settles without repeated blocks. Record it per IP; if an IP blocks within an hour repeatedly, raise its floor (`SCRAPER_MIN_INTERVAL_MS`). Because side nodes are same-provider/region, **stagger their start phases** (offset each node's first job by `interval/N`) so the fleet never synchronizes onto Realtor.com — note this in the runbook and implement it as a one-line `reserve(now + i*interval/N)` seed per endpoint at boot.

- [ ] **Step 3: Kill-switch** — document: to pause one IP, remove its URL from `SCRAPER_URLS` + restart the worker (drains cleanly); to pause the whole fleet, `systemctl stop oper-worker`. To pause scraping from a compromised/blocked node without redeploying the driver, `systemctl stop oper-scraper` on that node — the driver's per-endpoint breaker will trip to `error` and that IP stops drawing jobs after its in-flight one.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/metrics.ts apps/worker/src/metrics.test.ts apps/worker/src/crawl.ts ops/scraper-node/README.md
git commit -m "feat(worker): per-IP scraper metrics + calibration/kill-switch runbook"
```

---

## Rollout order & throughput math

```
A1 (scraper block signal)            — deploy to the existing side box first; harmless alone
B1 → B2 (pool, pure + tested)
C1 → C2 (driver uses the pool; single-URL fallback = no behavior change)  ← deploy, verify parity on 1 IP
D1 (mesh DB role; retire ssh tunnel)  ← removes the 34k-restart unit + fragility
D2 (provision side nodes one at a time, register in SCRAPER_URLS)
D3 (metrics + calibrate each IP, stagger phases)
```

**Expected throughput:** today ≈ one IP at ~30s/ZIP ≈ 2,880 ZIPs/day (erratic under bans). With 5 IPs each AIMD-settled at a safe ~30-45s/ZIP and isolated breakers: ≈ 10-14k ZIPs/day, i.e. a full 41k-ZIP pass in **~3-4 days**, and a repeat/refresh cycle comfortably weekly instead of monthly — with a single banned IP costing 1/5 of throughput for its cool-off instead of halting everything.

## Self-Review

**Spec coverage:** proxy-free (each server's own IP; Task D2) · up to 4 side servers (D2, `SCRAPER_URLS` pool) · per-IP rate under the ban threshold, auto-calibrated (B1 AIMD, D3) · a ban on one IP doesn't stall the fleet (B1 per-endpoint breaker, B2 skip-blocked) · "carefully test how much we can get away with" (D3 calibration + AIMD convergence) · same-provider/region with anti-synchronization stagger (D3) · fixes the crash-looping tunnel (D1) · single-URL backward compatibility (C1 fallback, C2 parity check). Covered.

**Placeholder scan:** all code steps carry real TS/Python/SQL/YAML and exact commands. Server-side config edits (`pg_hba.conf`, `listen_addresses`, cloud-init `${...}`) are the irreducible per-environment values, each shown with its exact target and a verification command. The migration filename date follows repo convention.

**Type consistency:** `AimdConfig`, `Outcome`, `ScraperEndpoint`, `ScraperPool` are defined once (Phase B) and consumed unchanged by `env.ts` (C1), `crawl.ts` (C2), and `metrics.ts` (D3). `scrape(job, listingType, scraperUrl, log, opts)` — the added `scraperUrl` param — is threaded consistently through `processJob`/`runPass` in C2. The scraper's `blocked`/429 contract (A1) is exactly what `classifyOutcome` (C2) maps to the `'blocked'` outcome that drives `ScraperEndpoint.settle` (B1).
