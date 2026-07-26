import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildArchivePropertyQuery, buildPropertyQuery, loadPropertyRow } from './property';

interface Q { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> }

const query = vi.fn();
const client: Q = { query: (s, p) => query(s, p) };

beforeEach(() => { query.mockReset(); });

describe('buildArchivePropertyQuery', () => {
  it('reads the archive, not the live table', () => {
    const sql = buildArchivePropertyQuery();
    expect(sql).toContain('listings_archive');
    expect(sql).not.toMatch(/FROM listings\b(?!_archive)/);
  });

  it('selects the same shape as the live query, so callers cannot tell them apart', () => {
    // Identical apart from the table name. Any drift means the archive returns a
    // different shape and shapePropertyRow silently mis-maps an archived row.
    expect(buildArchivePropertyQuery().replace(/listings_archive/g, 'listings'))
      .toBe(buildPropertyQuery());
  });
});

describe('loadPropertyRow read-through', () => {
  it('returns a live row without touching the archive', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: '1', address: 'live' }] });
    const row = await loadPropertyRow(client, '1');
    expect((row as { address: string }).address).toBe('live');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('falls through to the archive when the live table misses', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [{ id: '2', address: 'archived' }] });
    const row = await loadPropertyRow(client, '2');
    expect((row as { address: string }).address).toBe('archived');
    expect(query).toHaveBeenCalledTimes(2);
    expect(String(query.mock.calls[1]?.[0])).toContain('listings_archive');
  });

  it('returns null only when BOTH miss — never a false 404', async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await loadPropertyRow(client, '3')).toBeNull();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('does not let an archive failure hide a live row', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: '4', address: 'live' }] });
    query.mockRejectedValueOnce(new Error('archive down'));
    const row = await loadPropertyRow(client, '4');
    expect((row as { address: string }).address).toBe('live');
  });

  it('survives the archive table not existing yet', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    query.mockRejectedValueOnce(Object.assign(new Error('no table'), { code: '42P01' }));
    expect(await loadPropertyRow(client, '5')).toBeNull();
  });
});
