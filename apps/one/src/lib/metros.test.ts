import { describe, it, expect } from 'vitest';
import { METROS, DEFAULT_METRO, metroByZip, nearestMetro } from './metros';

describe('metros', () => {
  it('has a stable default metro with a real zip', () => {
    expect(DEFAULT_METRO.zip).toMatch(/^\d{5}$/);
    expect(METROS.length).toBeGreaterThanOrEqual(8);
  });
  it('maps a known zip to its metro', () => {
    expect(metroByZip('90004')?.label).toBe('Los Angeles');
    expect(metroByZip('00000')).toBeNull();
  });
  it('finds the nearest metro to a coordinate', () => {
    // Near downtown Houston
    expect(nearestMetro(29.75, -95.36).label).toBe('Houston');
  });
});
