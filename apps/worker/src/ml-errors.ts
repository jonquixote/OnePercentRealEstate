// Failure taxonomy for the rent worker's ML calls.
//
// The old behavior marked ANY error 'failed' permanently — so every ML
// restart converted the in-flight batch into rows that no one ever
// retried (171K of them by 2026-07-05). The taxonomy is deliberately
// simple: an error is 'permanent' only when the evidence says THIS ROW
// can never succeed (4xx = bad payload, 500 = estimator raised on this
// input, contract violations). Everything else — connection refused,
// timeouts, 502/503, DB blips — is 'transient': the row stays 'pending'
// and the circuit breaker pauses the drain while the dependency heals.

export type MlFailureKind = 'transient' | 'permanent';

export function classifyMlError(message: string): MlFailureKind {
  const m = message.toLowerCase();
  if (m.startsWith('ml 4') || m.startsWith('ml 500') || m.includes('ml returned')) {
    return 'permanent';
  }
  return 'transient';
}

// Minimal time-injectable circuit breaker. After `threshold` consecutive
// transient failures the breaker opens for baseOpenMs, doubling per
// consecutive trip up to maxOpenMs. Any success resets everything.
export class CircuitBreaker {
  private consecutiveFailures = 0;
  private openUntil = 0;
  private trips = 0;

  constructor(
    private readonly threshold = 5,
    private readonly baseOpenMs = 30_000,
    private readonly maxOpenMs = 300_000,
  ) {}

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.trips = 0;
  }

  recordTransientFailure(now: number = Date.now()): void {
    // While open, in-flight stragglers from the SAME outage keep failing.
    // Counting them escalates the window without new information — that
    // drove a ~15s deploy blip to the 300s cap on 2026-07-05 (a batch of
    // 200 concurrent requests all connection-refused at once). Only
    // failures after the window has closed carry signal.
    if (now < this.openUntil) return;
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.threshold) {
      const openMs = Math.min(this.baseOpenMs * 2 ** this.trips, this.maxOpenMs);
      this.openUntil = now + openMs;
      this.trips += 1;
      this.consecutiveFailures = 0;
    }
  }

  isOpen(now: number = Date.now()): boolean {
    return now < this.openUntil;
  }

  msUntilClose(now: number = Date.now()): number {
    return Math.max(0, this.openUntil - now);
  }
}
