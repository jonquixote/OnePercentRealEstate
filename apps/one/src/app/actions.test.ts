import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  poolMock,
  clientMock,
  cachedMock,
  bumpCacheVersionMock,
  buildListingsQueryMock,
  shapeListingRowMock,
  buildPropertyQueryMock,
  shapePropertyRowMock,
  buildDemographicsQueriesMock,
  shapeDemographicsMock,
} = vi.hoisted(() => {
  return {
    poolMock: { connect: vi.fn(), query: vi.fn() },
    clientMock: { query: vi.fn(), release: vi.fn() },
    cachedMock: vi.fn(),
    bumpCacheVersionMock: vi.fn(),
    buildListingsQueryMock: vi.fn(),
    shapeListingRowMock: vi.fn(),
    buildPropertyQueryMock: vi.fn(),
    shapePropertyRowMock: vi.fn(),
    buildDemographicsQueriesMock: vi.fn(),
    shapeDemographicsMock: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({ default: poolMock }));
vi.mock('@/lib/cache', () => ({
  cached: cachedMock,
  bumpCacheVersion: bumpCacheVersionMock,
  CACHE_TTL: { listing: 60, stats: 300, hud: 86400 },
}));
vi.mock('@/lib/queries/properties', () => ({
  buildListingsQuery: buildListingsQueryMock,
  shapeListingRow: shapeListingRowMock,
}));
vi.mock('@/lib/queries/property', () => ({
  buildPropertyQuery: buildPropertyQueryMock,
  shapePropertyRow: shapePropertyRowMock,
  buildDemographicsQueries: buildDemographicsQueriesMock,
  shapeDemographics: shapeDemographicsMock,
}));

import {
  getProperties,
  getHudBenchmark,
  getProperty,
  getDemographics,
  updatePropertyRent,
} from './actions';

beforeEach(() => {
  vi.clearAllMocks();
  poolMock.connect.mockResolvedValue(clientMock);
});

describe('getProperties', () => {
  it('delegates to cached() with a key composed from page/limit/sort/filters/cursor and the listing TTL', async () => {
    cachedMock.mockResolvedValue({ items: [], nextCursor: null });

    await getProperties(2, 50, 'newest', { minPrice: 100000 }, 'c123');

    expect(cachedMock).toHaveBeenCalledWith(
      'properties:p2:l50:snewest:{"minPrice":100000}:cc123',
      60,
      expect.any(Function),
    );
  });

  it('emits a keyset cursor from the last item id when sorting by newest and the page is full', async () => {
    cachedMock.mockImplementation((_key: string, _ttl: number, fn: () => unknown) => fn());
    buildListingsQueryMock.mockReturnValue({ sql: 'SQL', params: [] });
    clientMock.query.mockResolvedValue({ rows: [{ id: 1 }, { id: 2 }] });
    shapeListingRowMock.mockImplementation((row: unknown) => row);

    const result = await getProperties(1, 2, 'newest');

    expect(result.items).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.nextCursor).toBe(2);
    expect(clientMock.release).toHaveBeenCalledTimes(1);
  });

  it('does not emit a cursor when the page is not full', async () => {
    cachedMock.mockImplementation((_key: string, _ttl: number, fn: () => unknown) => fn());
    buildListingsQueryMock.mockReturnValue({ sql: 'SQL', params: [] });
    clientMock.query.mockResolvedValue({ rows: [{ id: 1 }, { id: 2 }] });
    shapeListingRowMock.mockImplementation((row: unknown) => row);

    const result = await getProperties(1, 5, 'newest');

    expect(result.nextCursor).toBeNull();
  });

  it('does not emit a cursor for non-newest sorts even when the page is full', async () => {
    cachedMock.mockImplementation((_key: string, _ttl: number, fn: () => unknown) => fn());
    buildListingsQueryMock.mockReturnValue({ sql: 'SQL', params: [] });
    clientMock.query.mockResolvedValue({ rows: [{ id: 1 }, { id: 2 }] });
    shapeListingRowMock.mockImplementation((row: unknown) => row);

    const result = await getProperties(1, 2, 'price_asc');

    expect(result.nextCursor).toBeNull();
  });

  it('releases the client and returns an empty fallback when the query throws', async () => {
    cachedMock.mockImplementation((_key: string, _ttl: number, fn: () => unknown) => fn());
    buildListingsQueryMock.mockReturnValue({ sql: 'SQL', params: [] });
    clientMock.query.mockRejectedValue(new Error('connection terminated unexpectedly'));

    const result = await getProperties();

    expect(result).toEqual({ items: [], nextCursor: null });
    expect(clientMock.release).toHaveBeenCalledTimes(1);
  });

  it('returns an empty fallback when cached() itself rejects', async () => {
    cachedMock.mockRejectedValue(new Error('redis down'));

    const result = await getProperties();

    expect(result).toEqual({ items: [], nextCursor: null });
  });
});

describe('getHudBenchmark', () => {
  it('delegates to cached() with a hud:<zip> key and the hud TTL', async () => {
    cachedMock.mockResolvedValue(null);

    await getHudBenchmark('78701');

    expect(cachedMock).toHaveBeenCalledWith('hud:78701', 86400, expect.any(Function));
  });

  it('returns the safmr_data array when the DB reports data', async () => {
    cachedMock.mockImplementation((_key: string, _ttl: number, fn: () => unknown) => fn());
    const safmrData = [{ bedrooms: 1, safmr: 900 }];
    clientMock.query.mockResolvedValue({ rows: [{ safmr_data: safmrData, fy: 2023 }] });

    const result = await getHudBenchmark('78701');

    expect(result).toEqual(safmrData);
    expect(clientMock.release).toHaveBeenCalledTimes(1);
  });

  it('returns null when no safmr_data is present', async () => {
    cachedMock.mockImplementation((_key: string, _ttl: number, fn: () => unknown) => fn());
    clientMock.query.mockResolvedValue({ rows: [{ safmr_data: null, fy: null }] });

    const result = await getHudBenchmark('00000');

    expect(result).toBeNull();
  });

  it('returns null when cached() rejects', async () => {
    cachedMock.mockRejectedValue(new Error('redis down'));

    const result = await getHudBenchmark('78701');

    expect(result).toBeNull();
  });
});

describe('getProperty', () => {
  it('returns null when no row is found', async () => {
    clientMock.query.mockResolvedValue({ rows: [] });

    const result = await getProperty('missing-id');

    expect(result).toBeNull();
    expect(clientMock.release).toHaveBeenCalledTimes(1);
  });

  it('shapes the row via shapePropertyRow when found', async () => {
    buildPropertyQueryMock.mockReturnValue('SELECT * FROM listings WHERE listings.id = $1');
    clientMock.query.mockResolvedValue({ rows: [{ id: '1' }] });
    shapePropertyRowMock.mockReturnValue({ id: '1', shaped: true });

    const result = await getProperty('1');

    expect(clientMock.query).toHaveBeenCalledWith(
      'SELECT * FROM listings WHERE listings.id = $1',
      ['1'],
    );
    expect(shapePropertyRowMock).toHaveBeenCalledWith({ id: '1' });
    expect(result).toEqual({ id: '1', shaped: true });
  });

  it('returns null and releases the client when the query throws', async () => {
    clientMock.query.mockRejectedValue(new Error('connection terminated unexpectedly'));

    const result = await getProperty('1');

    expect(result).toBeNull();
    expect(clientMock.release).toHaveBeenCalledTimes(1);
  });
});

describe('getDemographics', () => {
  it('runs the ACS and flood queries and combines them via shapeDemographics', async () => {
    buildDemographicsQueriesMock.mockReturnValue(['ACS_SQL', 'FLOOD_SQL']);
    const acsResult = { rows: [{ median_hh_income: '65000' }] };
    const floodResult = { rows: [{ nri_overall_rating: 'Moderate' }] };
    clientMock.query.mockImplementation((sql: string) =>
      sql === 'ACS_SQL' ? Promise.resolve(acsResult) : Promise.resolve(floodResult),
    );
    shapeDemographicsMock.mockReturnValue({ combined: true });

    const result = await getDemographics('78701');

    expect(clientMock.query).toHaveBeenCalledWith('ACS_SQL', ['78701']);
    expect(clientMock.query).toHaveBeenCalledWith('FLOOD_SQL', ['78701']);
    expect(shapeDemographicsMock).toHaveBeenCalledWith(acsResult, floodResult);
    expect(result).toEqual({ combined: true });
    expect(clientMock.release).toHaveBeenCalledTimes(1);
  });

  it('returns null and releases the client when a query throws', async () => {
    buildDemographicsQueriesMock.mockReturnValue(['ACS_SQL', 'FLOOD_SQL']);
    clientMock.query.mockRejectedValue(new Error('connection terminated unexpectedly'));

    const result = await getDemographics('78701');

    expect(result).toBeNull();
    expect(clientMock.release).toHaveBeenCalledTimes(1);
  });
});

describe('updatePropertyRent', () => {
  it('rounds the rent, persists it, bumps the cache version, and reports success', async () => {
    clientMock.query.mockResolvedValue({});

    const result = await updatePropertyRent('id1', 1234.6);

    expect(clientMock.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE listings'), [
      1235,
      'id1',
    ]);
    expect(bumpCacheVersionMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true });
    expect(clientMock.release).toHaveBeenCalledTimes(1);
  });

  it('returns a failure result and does not bump the cache version when the update throws', async () => {
    const error = new Error('constraint violation');
    clientMock.query.mockRejectedValue(error);

    const result = await updatePropertyRent('id1', 1000);

    expect(result).toEqual({ success: false, error });
    expect(bumpCacheVersionMock).not.toHaveBeenCalled();
    expect(clientMock.release).toHaveBeenCalledTimes(1);
  });
});