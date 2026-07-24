import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { z } from "zod";
import { cached, CACHE_TTL } from "@/lib/cache";

const HistoryPointSchema = z.object({
  observed_at: z.string(),
  price: z.number().nullable(),
  estimated_rent: z.number().nullable(),
  days_on_market: z.number().nullable(),
});

const HistoryResponseSchema = z.object({
  points: z.array(HistoryPointSchema),
});

type HistoryResponse = z.infer<typeof HistoryResponseSchema>;

/**
 * GET /api/properties/[id]/history
 * Returns up to 30 historical data points for a listing from the listings_history table.
 * Points are ordered chronologically (ascending by observed_at).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<HistoryResponse>> {
  try {
    const { id } = await params;

    if (!id || isNaN(Number(id)) || !Number.isInteger(Number(id))) {
      return NextResponse.json({ error: 'Invalid property id', points: [] }, { status: 400 });
    }

    const listingId = BigInt(id);

    const data = await cached(`history:${id}`, CACHE_TTL.history, async () => {
      const result = await pool.query<{
        observed_at: string;
        price: string | null;
        estimated_rent: string | null;
        days_on_market: number | null;
      }>(
        `
          SELECT
            observed_at,
            price,
            estimated_rent,
            days_on_market
          FROM listings_history
          WHERE listing_id = $1
          ORDER BY observed_at ASC
          LIMIT 30
        `,
        [listingId.toString()]
      );

      return result.rows.map((row) => ({
        observed_at: row.observed_at,
        price: row.price ? parseFloat(row.price) : null,
        estimated_rent: row.estimated_rent ? parseFloat(row.estimated_rent) : null,
        days_on_market: row.days_on_market,
      }));
    });

    return NextResponse.json({ points: data ?? [] }, { status: 200 });
  } catch (err) {
    console.error("[history] error:", err);
    return NextResponse.json(
      { error: "Failed to fetch listing history", points: [] },
      { status: 500 }
    );
  }
}
