import { describe, it, expect } from 'vitest';
import { INDEX_METROS, indexMetroBySlug } from './index-metros';

describe('index-metros', () => {
  it('has >= 10 metros, each with zip3 prefixes and a rep zip', () => {
    expect(INDEX_METROS.length).toBeGreaterThanOrEqual(10);
    for (const m of INDEX_METROS) {
      expect(m.zip3.length).toBeGreaterThan(0);
      expect(m.repZip).toMatch(/^\d{5}$/);
      expect(m.zip3.every((z) => /^\d{3}$/.test(z))).toBe(true);
    }
  });
  it('looks up by slug', () => {
    expect(indexMetroBySlug('houston')?.label).toBe('Houston');
    expect(indexMetroBySlug('nope')).toBeNull();
  });
});
