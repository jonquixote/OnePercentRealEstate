/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import {
  buildPropertyQuery,
  shapePropertyRow,
  buildDemographicsQueries,
  shapeDemographics,
} from './property';

describe('buildPropertyQuery', () => {
  it('returns a single-parameter query keyed on listings.id', () => {
    const sql = buildPropertyQuery();
    expect(sql).toContain('WHERE listings.id = $1');
    expect(sql).toContain('FROM listings');
  });

  it('is pure and returns identical text on every call', () => {
    expect(buildPropertyQuery()).toBe(buildPropertyQuery());
  });

  it('joins insurance_state_avg via a regex-parsed state, not a raw column', () => {
    const sql = buildPropertyQuery();
    expect(sql).toContain('LEFT JOIN insurance_state_avg ins_state');
    expect(sql).toContain("substring(listings.address from ', ([A-Z]{2}) ')");
  });
});

describe('shapePropertyRow', () => {
  const baseRow = {
    id: 1,
    address: '123 Main St, Austin, TX',
    listing_price: '250000',
    estimated_rent: '2000',
    bedrooms: '3',
    bathrooms: '2',
    sqft: '1500',
    latitude: '30.1',
    longitude: '-97.7',
    raw_data: {},
    images: [],
    primary_photo: null,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    hoa_fee: null,
    tax_annual_amount: '3000',
    assessed_value: null,
    estimated_value: null,
    insurance_state_avg: '1200',
    last_sold_price: null,
    price_cut_pct: null,
    first_list_price: null,
    rent_low: '1800',
    rent_high: '2200',
    motivated_score: '4.5',
    status: null,
    media_blur: null,
  };

  it('coerces numeric-string pg columns to numbers', () => {
    const shaped = shapePropertyRow(baseRow);
    expect(shaped.listing_price).toBe(250000);
    expect(shaped.estimated_rent).toBe(2000);
    expect(shaped.tax_annual_amount).toBe(3000);
    expect(shaped.insurance_state_avg).toBe(1200);
    expect(shaped.rent_low).toBe(1800);
    expect(shaped.rent_high).toBe(2200);
    expect(shaped.motivated_score).toBe(4.5);
  });

  it('leaves nullable numeric fields as null when absent', () => {
    const shaped = shapePropertyRow(baseRow);
    expect(shaped.hoa_fee).toBeNull();
    expect(shaped.assessed_value).toBeNull();
    expect(shaped.estimated_value).toBeNull();
    expect(shaped.last_sold_price).toBeNull();
    expect(shaped.price_cut_pct).toBeNull();
    expect(shaped.first_list_price).toBeNull();
  });

  it('builds the financial_snapshot from bedrooms/bathrooms/sqft', () => {
    const shaped = shapePropertyRow(baseRow);
    expect(shaped.financial_snapshot).toEqual({ bedrooms: 3, bathrooms: 2, sqft: 1500 });
  });

  it('defaults financial_snapshot fields to 0 when missing', () => {
    const shaped = shapePropertyRow({ ...baseRow, bedrooms: null, bathrooms: null, sqft: null });
    expect(shaped.financial_snapshot).toEqual({ bedrooms: 0, bathrooms: 0, sqft: 0 });
  });

  it('defaults latitude/longitude to 0 when missing', () => {
    const shaped = shapePropertyRow({ ...baseRow, latitude: null, longitude: undefined });
    expect(shaped.latitude).toBe(0);
    expect(shaped.longitude).toBe(0);
  });

  it('converts a Date created_at to an ISO string', () => {
    const shaped = shapePropertyRow(baseRow);
    expect(shaped.created_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('passes through a string created_at unchanged', () => {
    const shaped = shapePropertyRow({ ...baseRow, created_at: '2025-06-01T12:00:00.000Z' });
    expect(shaped.created_at).toBe('2025-06-01T12:00:00.000Z');
  });

  it('falls back to now() when created_at is missing', () => {
    const shaped = shapePropertyRow({ ...baseRow, created_at: null });
    expect(() => new Date(shaped.created_at)).not.toThrow();
    expect(Number.isNaN(new Date(shaped.created_at).getTime())).toBe(false);
  });

  it('defaults status to "watch" when absent', () => {
    const shaped = shapePropertyRow({ ...baseRow, status: null });
    expect(shaped.status).toBe('watch');
  });

  it('keeps an explicit status', () => {
    const shaped = shapePropertyRow({ ...baseRow, status: 'contacted' });
    expect(shaped.status).toBe('contacted');
  });

  describe('estimated_rent fallback', () => {
    it('falls back to a national-average-derived rent when estimated_rent is 0', () => {
      const shaped = shapePropertyRow({
        ...baseRow,
        estimated_rent: 0,
        bedrooms: 2,
        listing_price: 500000,
      });
      // national avg for 2 beds is 1550, cap at 1.5% of price (7500) -> min is 1550
      expect(shaped.estimated_rent).toBe(1550);
    });

    it('caps the fallback rent at 1.5% of price when that is lower than the national average', () => {
      const shaped = shapePropertyRow({
        ...baseRow,
        estimated_rent: null,
        bedrooms: 3,
        listing_price: 50000, // 1.5% = 750, well below the 1950 national avg for 3 beds
      });
      expect(shaped.estimated_rent).toBe(750);
    });

    it('does not use the fallback when estimated_rent is a positive number', () => {
      const shaped = shapePropertyRow({ ...baseRow, estimated_rent: 2345 });
      expect(shaped.estimated_rent).toBe(2345);
    });
  });

  describe('images assembly', () => {
    it('prefers a populated images array', () => {
      const shaped = shapePropertyRow({
        ...baseRow,
        images: ['https://x/1.jpg', '', 'https://x/2.jpg'],
        primary_photo: 'https://x/primary.jpg',
      });
      expect(shaped.images).toEqual(['https://x/1.jpg', 'https://x/2.jpg']);
    });

    it('falls back to primary_photo + raw_data when images is empty', () => {
      const shaped = shapePropertyRow({
        ...baseRow,
        images: [],
        primary_photo: 'https://x/primary.jpg',
        raw_data: { primary_photo: 'https://x/primary.jpg', alt_photos: 'https://x/a.jpg,https://x/b.jpg' },
      });
      // primary_photo deduped against raw.primary_photo, alt_photos split on comma
      expect(shaped.images).toEqual([
        'https://x/primary.jpg',
        'https://x/a.jpg',
        'https://x/b.jpg',
      ]);
    });

    it('supports raw_data.alt_photos as an array', () => {
      const shaped = shapePropertyRow({
        ...baseRow,
        images: [],
        primary_photo: null,
        raw_data: { alt_photos: ['https://x/a.jpg', ' https://x/b.jpg '] },
      });
      expect(shaped.images).toEqual(['https://x/a.jpg', 'https://x/b.jpg']);
    });

    it('returns an empty array when there are no photo sources at all', () => {
      const shaped = shapePropertyRow({ ...baseRow, images: [], primary_photo: null, raw_data: {} });
      expect(shaped.images).toEqual([]);
    });
  });

  it('defaults raw_data to {} when missing', () => {
    const shaped = shapePropertyRow({ ...baseRow, raw_data: undefined });
    expect(shaped.raw_data).toEqual({});
  });

  it('defaults media_blur to null when missing', () => {
    const shaped = shapePropertyRow({ ...baseRow, media_blur: undefined });
    expect(shaped.media_blur).toBeNull();
  });
});

describe('buildDemographicsQueries', () => {
  it('returns [acsQuery, floodQuery] parameterized on zip/zcta', () => {
    const [acsQuery, floodQuery] = buildDemographicsQueries();
    expect(acsQuery).toContain('FROM zcta_demographics');
    expect(acsQuery).toContain('WHERE zcta = $1');
    expect(floodQuery).toContain('FROM census_tracts');
    expect(floodQuery).toContain('WHERE l.zip_code = $1');
  });
});

describe('shapeDemographics', () => {
  function rowsResult(rows: any[]) {
    return { rows };
  }

  it('returns null when both queries are empty', () => {
    expect(shapeDemographics(rowsResult([]), rowsResult([]))).toBeNull();
  });

  it('combines ACS + flood data and coerces numeric strings', () => {
    const acsRes = rowsResult([
      { median_hh_income: '65000', median_gross_rent: '1400', median_home_value: '310000' },
    ]);
    const floodRes = rowsResult([{ nri_overall_rating: 'Moderate' }]);

    expect(shapeDemographics(acsRes, floodRes)).toEqual({
      median_hh_income: 65000,
      median_gross_rent: 1400,
      median_home_value: 310000,
      nri_rating: 'Moderate',
    });
  });

  it('nulls out ACS fields when only flood data is present', () => {
    const result = shapeDemographics(rowsResult([]), rowsResult([{ nri_overall_rating: 'Very High' }]));
    expect(result).toEqual({
      median_hh_income: null,
      median_gross_rent: null,
      median_home_value: null,
      nri_rating: 'Very High',
    });
  });

  it('nulls out nri_rating when only ACS data is present', () => {
    const result = shapeDemographics(
      rowsResult([{ median_hh_income: '50000', median_gross_rent: null, median_home_value: null }]),
      rowsResult([]),
    );
    expect(result).toEqual({
      median_hh_income: 50000,
      median_gross_rent: null,
      median_home_value: null,
      nri_rating: null,
    });
  });
});