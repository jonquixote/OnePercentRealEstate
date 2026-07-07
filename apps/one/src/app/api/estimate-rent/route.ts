import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { safeErrorResponse } from '@/lib/api-error';
import { estimateRentLimiter, checkRateLimit } from '@/lib/rate-limit';

export async function POST(req: Request) {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rl = await checkRateLimit(estimateRentLimiter, ip);
    if (!rl.allowed) {
        return NextResponse.json(
            { error: 'Rate limit exceeded' },
            { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } }
        );
    }

    try {
        const body = await req.json();
        const { listing_id, lat, lon, beds, baths, sqft, zip_code, property_type, whatIf } = body;

        // Mode 1: what-if (user-adjusted params) → proxy to ml service
        if (whatIf && listing_id) {
            const mlPayload: Record<string, unknown> = { listing_id: Number(listing_id) };
            if (beds != null) mlPayload.bedrooms = Number(beds);
            if (baths != null) mlPayload.bathrooms = Number(baths);
            if (sqft != null) mlPayload.sqft = Number(sqft);

            const mlRes = await fetch('http://ml:8000/predict', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(mlPayload),
                signal: AbortSignal.timeout(10_000),
            });

            if (!mlRes.ok) {
                return NextResponse.json({ error: 'ML estimation failed' }, { status: 502 });
            }

            const mlData = await mlRes.json();

            return NextResponse.json({
                estimated_rent: mlData.predicted_rent,
                rent_low: mlData.rent_low,
                rent_high: mlData.rent_high,
                model_version: mlData.model_version,
                hud_fmr: null,
                comps_median: null,
                method: 'ml_proxy',
                confidence_score: mlData.rent_low && mlData.rent_high
                    ? Math.max(0, Math.min(1, 1 - (mlData.rent_high - mlData.rent_low) / mlData.predicted_rent))
                    : 0.5,
            });
        }

        // Mode 2: look up stored data for a listing
        if (!zip_code && !listing_id) {
            return NextResponse.json({ error: 'zip_code or listing_id required' }, { status: 400 });
        }

        let targetZip = zip_code;
        let listingId = listing_id;

        // Resolve listing to get zip if only listing_id given
        if (!targetZip && listingId) {
            const idRes = await pool.query(`SELECT raw_data->>'zip_code' AS zip FROM listings WHERE id = $1`, [listingId]);
            if (idRes.rows.length > 0) {
                targetZip = idRes.rows[0].zip || zip_code;
            }
        }

        // Fetch stored estimate + hud FMR + comps median in parallel
        const runQuery = async (q: string, p: any[]) => (await pool.query(q, p)).rows;
        const emptyRows: any[] = [];

        const [listingRows, hudRows, compsRows] = await Promise.all([
            listingId
                ? runQuery(`SELECT estimated_rent, rent_low, rent_high, rent_model_version FROM listings WHERE id = $1`, [listingId])
                : emptyRows,
            targetZip
                ? runQuery(`SELECT safmr FROM hud_safmr WHERE zip_code = $1 AND bedrooms = $2 ORDER BY fy DESC LIMIT 1`, [targetZip, (beds || 3)])
                : emptyRows,
            targetZip
                ? runQuery(`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY estimated_rent) AS comps_median FROM listings WHERE raw_data->>'zip_code' = $1 AND estimated_rent IS NOT NULL AND estimated_rent > 0 AND (id::text != $2 OR $2 IS NULL)`, [targetZip, listingId || ''])
                : emptyRows,
        ]);

        const lRow = listingRows[0] || {};
        const hRow = hudRows[0] || {};
        const cRow = compsRows[0] || {};

        const estimate = lRow.estimated_rent ? Number(lRow.estimated_rent) : null;
        const rentLow = lRow.rent_low ? Number(lRow.rent_low) : null;
        const rentHigh = lRow.rent_high ? Number(lRow.rent_high) : null;
        const hudFmr = hRow.safmr ? Number(hRow.safmr) : null;
        const compsMedian = cRow.comps_median ? Number(cRow.comps_median) : null;

        const confidenceScore = estimate && rentLow != null && rentHigh != null
            ? Math.max(0, Math.min(1, 1 - (rentHigh - rentLow) / estimate))
            : 0.5;

        return NextResponse.json({
            estimated_rent: estimate,
            rent_low: rentLow,
            rent_high: rentHigh,
            model_version: lRow.rent_model_version || 'v1',
            hud_fmr: hudFmr,
            comps_median: compsMedian,
            confidence_score: confidenceScore,
            method: estimate ? 'v1_stored' : 'unavailable',
            // backward-compat fields
            smart_estimate: estimate,
            comps_avg: compsMedian,
            comps_used: 0,
            comps: [],
            safmr_rent: hudFmr,
            property_type: null,
            reason: estimate ? 'stored' : 'no_data',
        });

    } catch (e: any) {
        console.error('Estimate rent error:', e);
        return safeErrorResponse(e, 500);
    }
}
