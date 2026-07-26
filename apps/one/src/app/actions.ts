'use server';

import pool from '@/lib/db';
import { cached, bumpCacheVersion, CACHE_TTL } from '@/lib/cache';
import {
  buildListingsQuery,
  shapeListingRow,
  type PropertyFilters,
} from '@/lib/queries/properties';
import {
  loadPropertyRow,
  shapePropertyRow,
  buildDemographicsQueries,
  shapeDemographics,
} from '@/lib/queries/property';

export async function getProperties(
  page = 1,
  limit = 100,
  sortBy = 'newest',
  filters?: PropertyFilters,
  cursor: string | null = null,
) {
  const key = `properties:p${page}:l${limit}:s${sortBy}:${JSON.stringify(filters || {})}:c${cursor || 'null'}`;
  try {
    return await cached(key, CACHE_TTL.listing, async () => {
      const { sql, params } = buildListingsQuery(filters, sortBy, page, limit, cursor);
      const client = await pool.connect();
      try {
        const result = await client.query(sql, params);
        const items = result.rows.map(shapeListingRow);
        // Only emit a cursor on sorts where the cursor itself is valid
        // for the next page (see cursorCompatible above). On OFFSET sorts
        // the caller should re-issue with `page + 1` instead.
        const cursorCompatible = sortBy === 'newest';
        return {
          items,
          nextCursor:
            cursorCompatible && items.length === limit
              ? items[items.length - 1].id
              : null,
        };
      } finally {
        client.release();
      }
    });
  } catch (error) {
    console.error('Database fetch error:', error);
    return { items: [], nextCursor: null };
  }
}

export async function getHudBenchmark(zipCode: string) {
  try {
    return await cached(`hud:${zipCode}`, CACHE_TTL.hud, async () => {
      const client = await pool.connect();
      try {
        const hudRes = await client.query(
          `SELECT jsonb_agg(jsonb_build_object('bedrooms', bedrooms, 'safmr', safmr) ORDER BY bedrooms) AS safmr_data,
                  MAX(fy) AS fy
           FROM hud_safmr
           WHERE zip_code = $1`,
          [zipCode],
        );

        if (hudRes.rows.length > 0 && hudRes.rows[0].safmr_data) {
          return hudRes.rows[0].safmr_data;
        }
        return null;
      } finally {
        client.release();
      }
    });
  } catch (error) {
    console.error('HUD fetch error:', error);
    return null;
  }
}

export async function getProperty(id: string) {
  try {
    const client = await pool.connect();
    try {
      // Read-through: live table, then cold storage. An archived listing must
      // still render — old links, shared URLs and ~33k sitemap entries depend
      // on it.
      const row = await loadPropertyRow(client, id);
      if (!row) return null;
      return shapePropertyRow(row);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Database fetch error:', error);
    return null;
  }
}

export async function getDemographics(zipCode: string) {
  try {
    const client = await pool.connect();
    try {
      const [acsQuery, floodQuery] = buildDemographicsQueries();
      const [acsRes, floodRes] = await Promise.all([
        client.query(acsQuery, [zipCode]),
        client.query(floodQuery, [zipCode]),
      ]);
      return shapeDemographics(acsRes, floodRes);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Demographics fetch error:', error);
    return null;
  }
}

// Persist smart estimate to database
export async function updatePropertyRent(id: string, rent: number, method?: string) {
  try {
    const client = await pool.connect();
    try {
      await client.query(
        `UPDATE listings
        SET estimated_rent = $1, updated_at = NOW()
        WHERE id = $2`,
        [Math.round(rent), id],
      );
      await bumpCacheVersion();
      return { success: true };
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Failed to update rent:', error);
    return { success: false, error };
  }
}
