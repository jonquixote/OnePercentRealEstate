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
export function classifyMlError(message) {
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
    threshold;
    baseOpenMs;
    maxOpenMs;
    consecutiveFailures = 0;
    openUntil = 0;
    trips = 0;
    constructor(threshold = 5, baseOpenMs = 30_000, maxOpenMs = 300_000) {
        this.threshold = threshold;
        this.baseOpenMs = baseOpenMs;
        this.maxOpenMs = maxOpenMs;
    }
    recordSuccess() {
        this.consecutiveFailures = 0;
        this.trips = 0;
    }
    recordTransientFailure(now = Date.now()) {
        // While open, in-flight stragglers from the SAME outage keep failing.
        // Counting them escalates the window without new information — that
        // drove a ~15s deploy blip to the 300s cap on 2026-07-05 (a batch of
        // 200 concurrent requests all connection-refused at once). Only
        // failures after the window has closed carry signal.
        if (now < this.openUntil)
            return;
        this.consecutiveFailures += 1;
        if (this.consecutiveFailures >= this.threshold) {
            const openMs = Math.min(this.baseOpenMs * 2 ** this.trips, this.maxOpenMs);
            this.openUntil = now + openMs;
            this.trips += 1;
            this.consecutiveFailures = 0;
        }
    }
    isOpen(now = Date.now()) {
        return now < this.openUntil;
    }
    msUntilClose(now = Date.now()) {
        return Math.max(0, this.openUntil - now);
    }
}
//# sourceMappingURL=ml-errors.js.map