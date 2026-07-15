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
