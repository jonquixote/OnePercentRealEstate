import { describe, it, expect } from 'vitest';
import { resolveLoc } from './route';

describe('resolveLoc', () => {
  it('prefers an explicit valid ?zip= over geo', () => {
    const sp = new URLSearchParams({ zip: '90004' });
    const { metro } = resolveLoc(sp, new Headers({ 'x-vercel-ip-latitude': '29.7', 'x-vercel-ip-longitude': '-95.3' }));
    expect(metro.label).toBe('Los Angeles');
  });
  it('ignores a malformed zip and falls back to geo', () => {
    const sp = new URLSearchParams({ zip: 'abcde' });
    const { metro } = resolveLoc(sp, new Headers({ 'x-vercel-ip-latitude': '29.75', 'x-vercel-ip-longitude': '-95.36' }));
    expect(metro.label).toBe('Houston');
  });
});
