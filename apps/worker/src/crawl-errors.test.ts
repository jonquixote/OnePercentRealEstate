import { describe, expect, it } from 'vitest';
import { isBlockError, isTransientScraperError } from './crawl-errors.js';

// These two classifiers gate the entire breaker/retry decision tree:
//   transient  → scraper unreachable   → re-pend + back off
//   block      → data source refused   → cool-off (don't hammer)
//   neither    → genuine failure       → record for the block fingerprint
// Getting the routing wrong either loses data (a transient marked failed) or
// worsens a ban (a block retried hard), so lock the behaviour down with tests.

describe('isTransientScraperError', () => {
  it('matches scraper-unreachable / network signals', () => {
    for (const m of [
      'fetch failed',
      'connect ECONNREFUSED 10.0.0.1:80',
      'read ECONNRESET',
      'write EPIPE',
      'socket hang up',
      'Client network socket disconnected before secure TLS connection was established',
      'other side closed',
      'getaddrinfo ENOTFOUND scraper.internal',
      'getaddrinfo EAI_AGAIN scraper.internal',
    ]) {
      expect(isTransientScraperError(m), m).toBe(true);
    }
  });

  it('does NOT match a scraper that responded with an error body', () => {
    // The scraper answered → the ZIP WAS attempted upstream; not transient.
    for (const m of [
      'scraper 500: homeharvest AuthenticationError',
      'scraper 403: forbidden',
      'scrape timeout after 240000ms',
      'all scrape passes failed: for_sale: scraper 500',
    ]) {
      expect(isTransientScraperError(m), m).toBe(false);
    }
  });
});

describe('isBlockError', () => {
  it('matches unambiguous block word-tokens', () => {
    for (const m of [
      'scraper 500: homeharvest.exceptions.AuthenticationError',
      'unauthorized',
      'Forbidden',
      'too many requests',
      'captcha required',
      'access denied',
      'rate limit exceeded',
      'rate-limited',
    ]) {
      expect(isBlockError(m), m).toBe(true);
    }
  });

  it('matches bare status codes only in an HTTP/scraper-status context', () => {
    for (const m of ['scraper 403: nope', 'HTTP 429', 'status=401', 'status: 403']) {
      expect(isBlockError(m), m).toBe(true);
    }
  });

  it('does NOT false-positive on 401/403/429 embedded elsewhere (price, id)', () => {
    for (const m of [
      'inserted listing priced at 403000',
      'property id 429123 skipped',
      'scrape returned 401 rows', // count, not a status
      'fetch failed',
    ]) {
      expect(isBlockError(m), m).toBe(false);
    }
  });

  it('keeps transient and block classifications disjoint for their own signals', () => {
    expect(isBlockError('ECONNREFUSED')).toBe(false);
    expect(isTransientScraperError('AuthenticationError')).toBe(false);
  });
});
