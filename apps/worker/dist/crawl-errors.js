// Scrape-error classifiers for the crawl worker's retry / circuit-breaker
// decision tree. Extracted into their own pure module (no side effects) so they
// can be unit-tested without importing crawl.ts, which boots the worker
// (pool, LISTEN, runner loops) on import.
//
// Three outcomes hinge on these regexes:
//   transient  → scraper itself unreachable; re-pend + back off (no data lost).
//   block      → the DATA SOURCE (Realtor.com) refused us; cool-off, don't hammer.
//   (neither)  → a genuine failure; record it for the block fingerprint.
// A "transient" failure means the scraper itself was unreachable (process
// down / OOM-restart / network blip) — the ZIP was never actually attempted
// upstream. These are re-pended (not failed) so no data is lost, and the
// runner backs off. NOTE: a scraper HTTP 4xx/5xx is deliberately NOT
// transient — it means the scraper responded (e.g. a Realtor.com auth block
// surfaced as `scraper 500: ...AuthenticationError...`), which must be
// recorded as a real failure so the block detector can see it.
export function isTransientScraperError(msg) {
    return /fetch failed|ECONNREFUSED|ECONNRESET|EPIPE|socket hang up|other side closed|network|ENOTFOUND|EAI_AGAIN/i.test(msg);
}
// A "block" error means Realtor.com/homeharvest rejected the request because
// our IP is rate-limited or banned — it surfaces as `scraper 500:
// ...AuthenticationError...` (403/401 upstream). This is distinct from a
// transient (scraper-down) error: the scraper responded, the DATA SOURCE
// refused. When we see this we must STOP hammering (cool-off), not retry hard.
export function isBlockError(msg) {
    // Word-token signals are unambiguous. Bare status codes (401/403/429) are
    // only treated as a block when they appear in an HTTP/scraper-status context
    // (e.g. "scraper 403:" or "HTTP 429") so a number embedded elsewhere in a
    // truncated error body (a price, an id) can't false-positive.
    return /AuthenticationError|unauthorized|forbidden|too many requests|captcha|access denied|rate.?limit|(?:scraper|status|HTTP)\s*[:=]?\s*(?:401|403|429)\b/i.test(msg);
}
//# sourceMappingURL=crawl-errors.js.map