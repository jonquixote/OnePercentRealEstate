import { describe, it, expect } from 'vitest';
import { buildDealTitle, buildDealDescription } from './deal-meta';

const lite = { address: '10562 Windsor Lake Ct, Tampa, FL 33626', city: 'Tampa', state: 'FL',
  price: 245000, rent: 2767, ratioPct: 1.13, beds: 3, baths: 2 };

describe('buildDealTitle', () => {
  it('leads with address + the deal headline', () => {
    expect(buildDealTitle(lite)).toBe(
      '10562 Windsor Lake Ct, Tampa, FL 33626 — $245,000 · 3bd · ~1.1% rule | OnePercent',
    );
  });
  it('omits ratio cleanly when rent is unknown', () => {
    expect(buildDealTitle({ ...lite, rent: null, ratioPct: null })).toBe(
      '10562 Windsor Lake Ct, Tampa, FL 33626 — $245,000 · 3bd | OnePercent',
    );
  });
  it('falls back to a valid generic title with no address', () => {
    expect(buildDealTitle({ ...lite, address: null })).toBe('Rental property deal | OnePercent');
  });
});

describe('buildDealDescription', () => {
  it('states modeled rent + ratio as an estimate', () => {
    expect(buildDealDescription(lite)).toContain('modeled rent $2,767/mo');
    expect(buildDealDescription(lite)).toContain('~1.1% rule');
    expect(buildDealDescription(lite)).toContain('Tampa, FL');
  });
});
