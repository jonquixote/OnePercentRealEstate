import { describe, it, expect } from 'vitest';
import { isScored } from './rent-scored.js';

describe('isScored', () => {
  it('accepts a real rent', () => {
    expect(isScored(1500)).toBe(true);
    expect(isScored(0.5)).toBe(true);
  });

  it('rejects zero — the legacy sentinel that Number.isFinite let through', () => {
    expect(isScored(0)).toBe(false);
    expect(isScored(-0)).toBe(false);
  });

  it('rejects negatives, non-finite values and non-numbers', () => {
    for (const v of [-100, NaN, Infinity, -Infinity, null, undefined, '1500', {}]) {
      expect(isScored(v)).toBe(false);
    }
  });
});
