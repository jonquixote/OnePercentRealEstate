import { describe, expect, it } from 'vitest';
import { CircuitBreaker, classifyMlError } from './ml-errors.js';

describe('classifyMlError', () => {
  it('classifies undici connection failures as transient', () => {
    expect(classifyMlError('fetch failed')).toBe('transient');
  });

  it('classifies our own timeout message as transient', () => {
    expect(classifyMlError('ml timeout after 30000ms')).toBe('transient');
  });

  it('classifies ml 502/503 (service unavailable) as transient', () => {
    expect(classifyMlError('ml 503: upstream restarting')).toBe('transient');
    expect(classifyMlError('ml 502: bad gateway')).toBe('transient');
  });

  it('classifies ml 4xx (bad request for THIS row) as permanent', () => {
    expect(classifyMlError('ml 400: latitude and longitude required')).toBe('permanent');
  });

  it('classifies ml 500 (estimator raised on THIS row) as permanent', () => {
    expect(classifyMlError('ml 500: estimator error: bad sqft')).toBe('permanent');
  });

  it('classifies response-contract violations as permanent', () => {
    expect(classifyMlError('ml returned invalid predicted_rent: NaN')).toBe('permanent');
    expect(classifyMlError('ml returned missing model_version')).toBe('permanent');
  });

  it('defaults unknown errors (e.g. DB write blips) to transient — retry-safe', () => {
    expect(classifyMlError('connection terminated unexpectedly')).toBe('transient');
  });
});

describe('CircuitBreaker', () => {
  it('opens after threshold consecutive transient failures, closes after baseOpenMs', () => {
    const b = new CircuitBreaker(3, 30_000, 300_000);
    const t0 = 1_000_000;
    b.recordTransientFailure(t0);
    b.recordTransientFailure(t0);
    expect(b.isOpen(t0)).toBe(false);
    b.recordTransientFailure(t0);
    expect(b.isOpen(t0)).toBe(true);
    expect(b.msUntilClose(t0)).toBe(30_000);
    expect(b.isOpen(t0 + 30_000)).toBe(false);
  });

  it('doubles the open window per consecutive trip, capped at maxOpenMs', () => {
    const b = new CircuitBreaker(1, 30_000, 120_000);
    b.recordTransientFailure(0); // trip 1 -> open 30s
    expect(b.isOpen(29_999)).toBe(true);
    expect(b.isOpen(30_000)).toBe(false);
    b.recordTransientFailure(30_000); // trip 2 -> open 60s
    expect(b.isOpen(89_999)).toBe(true);
    expect(b.isOpen(90_000)).toBe(false);
    b.recordTransientFailure(90_000); // trip 3 -> min(120s, cap 120s)
    b.recordTransientFailure(210_000); // trip 4 -> still capped at 120s
    expect(b.isOpen(329_999)).toBe(true);
    expect(b.isOpen(330_000)).toBe(false);
  });

  it('does NOT escalate the open window from in-flight stragglers of the same outage', () => {
    // Regression for the 2026-07-05 incident: a batch of 200 concurrent
    // requests all connection-refused during a ~15s ML deploy blip and
    // escalated the breaker to its 300s cap.
    const b = new CircuitBreaker(5, 30_000, 300_000);
    for (let i = 0; i < 5; i++) b.recordTransientFailure(0); // trip -> open 30s
    expect(b.msUntilClose(0)).toBe(30_000);
    for (let i = 0; i < 200; i++) b.recordTransientFailure(1_000); // stragglers
    // Window unchanged: still closing at t=30000, not pushed to the cap.
    expect(b.msUntilClose(1_000)).toBe(29_000);
  });

  it('a success resets both the failure count and the trip escalation', () => {
    const b = new CircuitBreaker(2, 30_000, 300_000);
    b.recordTransientFailure(0);
    b.recordSuccess();
    b.recordTransientFailure(1);
    expect(b.isOpen(1)).toBe(false); // count restarted from zero
  });
});
