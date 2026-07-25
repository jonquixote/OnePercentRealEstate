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
  // Fail-away: consecutive 'error' outcomes before an endpoint leaves rotation.
  // 'error' deliberately does not change PACING (it is usually a transient
  // network blip), but a permanently dead endpoint was therefore retried at
  // full rate forever — 290 consecutive errors and ~10h of zero listings on
  // 2026-07-24. Sidelining lets a healthy endpoint take the traffic.
  failawayStreak?: number;      // default 10
  failawayCooloffMs?: number;   // default 5 min
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export class ScraperEndpoint {
  readonly url: string;
  intervalMs: number;
  stats = { ok: 0, blocked: 0, error: 0 };
  private cfg: AimdConfig;
  private nextStart = 0;   // epoch ms; earliest this endpoint may start a job
  private blockedUntil = 0;
  private cooloff = 0;     // current escalating cool-off
  private errorStreak = 0;      // consecutive 'error' outcomes (reset by any ok)
  private sidelinedUntil = 0;   // epoch ms; set once the streak trips

  // `now` is accepted for constructor signature compatibility with
  // ScraperPool (and test call sites that pass a fake clock) but isn't
  // stored — every method that needs "now" takes it as an explicit `atMs`
  // parameter instead.
  constructor(url: string, cfg: AimdConfig, now: () => number = Date.now) {
    this.url = url;
    this.cfg = cfg;
    void now;
    this.intervalMs = cfg.startIntervalMs;
  }

  // Epoch ms at which this endpoint's current block cool-off ends; 0 if not
  // cooling. Exposed read-only for the aggregate crawler_block_state upsert
  // in crawl.ts (see Fix 1 in the horizontal-scaling final-review wave) — the
  // per-endpoint breaker replaced the old single global one, but prod
  // monitoring's CrawlerBlockCooloff alert still needs a fleet-wide signal.
  get cooloffUntil(): number { return this.blockedUntil; }

  readyAt(): number { return Math.max(this.nextStart, this.blockedUntil); }

  /**
   * True while this endpoint is sidelined for sustained errors. Sidelining is
   * a *preference* — ScraperPool.acquire() will still hand it back if every
   * endpoint is sidelined, because a pool that refuses to serve anything is
   * worse than one retrying a bad endpoint slowly.
   */
  isSidelined(atMs: number): boolean { return atMs < this.sidelinedUntil; }

  available(atMs: number): boolean {
    return atMs >= this.readyAt() && !this.isSidelined(atMs);
  }

  reserve(atMs: number): void {
    const jit = this.cfg.jitterFrac > 0 ? Math.random() * this.cfg.jitterFrac * this.intervalMs : 0;
    this.nextStart = atMs + this.intervalMs + jit;
  }

  settle(outcome: Outcome, atMs: number): void {
    this.stats[outcome]++;
    if (outcome === 'ok') {
      this.intervalMs = clamp(this.intervalMs - this.cfg.decreaseMs, this.cfg.minIntervalMs, this.cfg.maxIntervalMs);
      // Any success means the endpoint is alive — restart the fail-away streak.
      this.errorStreak = 0;
    } else if (outcome === 'blocked') {
      this.intervalMs = clamp(this.intervalMs * this.cfg.increaseFactor, this.cfg.minIntervalMs, this.cfg.maxIntervalMs);
      this.cooloff = this.cooloff === 0 ? this.cfg.cooloffMs : Math.min(this.cooloff * 2, this.cfg.cooloffMaxMs);
      this.blockedUntil = atMs + this.cooloff;
      // A block is an upstream signal about US, not a dead endpoint — the
      // cool-off above already handles it, so don't also count it as a failure.
      this.errorStreak = 0;
    } else {
      // 'error' still leaves PACING untouched (a transient blip must not slow a
      // healthy endpoint), but a sustained run of them sidelines the endpoint.
      this.errorStreak++;
      const streak = this.cfg.failawayStreak ?? 10;
      if (this.errorStreak >= streak) {
        this.sidelinedUntil = atMs + (this.cfg.failawayCooloffMs ?? 5 * 60_000);
        this.errorStreak = 0; // re-arm; if it's still dead it will trip again
      }
    }
  }
}

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

    // NEVER-EMPTY GUARANTEE. If nothing is available *only* because every
    // endpoint is sidelined for errors, fall back to the soonest-ready one and
    // keep crawling. A single-endpoint pool that sidelines itself would stop
    // the crawl completely — strictly worse than retrying a bad endpoint at
    // its normal pace. Endpoints still pacing/blocked correctly yield null so
    // the runner waits (that is ordinary AIMD, not a failure).
    if (best === null) {
      const pacedOrBlocked = this.endpoints.some((e) => atMs < e.readyAt());
      if (!pacedOrBlocked) {
        for (const e of this.endpoints) {
          if (best === null || e.readyAt() < best.readyAt()) best = e;
        }
      }
    }

    if (best) best.reserve(atMs);
    return best;
  }

  /** Endpoints currently sidelined for sustained errors (for degraded logging). */
  sidelined(atMs = this.now()): ScraperEndpoint[] {
    return this.endpoints.filter((e) => e.isSidelined(atMs));
  }

  nextReadyAt(): number {
    return Math.min(...this.endpoints.map((e) => e.readyAt()));
  }
}
