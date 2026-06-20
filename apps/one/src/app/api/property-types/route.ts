import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import redis from '@/lib/redis';

export const dynamic = 'force-dynamic';

const CACHE_KEY = 'property-types:v1';
const CACHE_TTL_S = 3600; // 1 hour — types rarely change

export async function GET() {
  try {
    const cached = await redis.get(CACHE_KEY).catch(() => null);
    if (cached) {
      return NextResponse.json(JSON.parse(cached), {
        headers: { 'X-Cache': 'HIT', 'Cache-Control': 'public, max-age=600, s-maxage=3600' },
      });
    }
  } catch {
    /* ignore */
  }

  try {
    const client = await pool.connect();
    try {
      const sql = `
        SELECT
          property_type,
          is_rentable,
          target_ratio,
          vacancy_rate,
          maintenance_rate,
          management_rate,
          capex_rate
        FROM public.property_type_rules
        ORDER BY is_rentable DESC, property_type ASC
      `;
      const result = await client.query(sql);

      const payload = result.rows.map((row: any) => ({
        propertyType: row.property_type,
        isRentable: row.is_rentable,
        targetRatio: row.target_ratio != null ? Number(row.target_ratio) : null,
        vacancyRate: row.vacancy_rate != null ? Number(row.vacancy_rate) : null,
        maintenanceRate: row.maintenance_rate != null ? Number(row.maintenance_rate) : null,
        managementRate: row.management_rate != null ? Number(row.management_rate) : null,
        capexRate: row.capex_rate != null ? Number(row.capex_rate) : null,
      }));

      redis.setex(CACHE_KEY, CACHE_TTL_S, JSON.stringify(payload)).catch(() => {});

      return NextResponse.json(payload, {
        headers: { 'X-Cache': 'MISS', 'Cache-Control': 'public, max-age=600, s-maxage=3600' },
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('/api/property-types error:', err);
    return NextResponse.json({ error: 'property types unavailable' }, { status: 500 });
  }
}
