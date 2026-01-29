import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function POST(req: Request) {
    try {
        const { locations } = await req.json(); // Expect { "locations": ["Cleveland, OH", ...] }

        // Start Validation
        if (!locations) {
            console.warn('Seed Jobs API: Missing locations in request body');
            return NextResponse.json({
                error: 'Missing locations',
                message: 'Request body must contain "locations" array'
            }, { status: 400 });
        }

        if (!Array.isArray(locations)) {
            console.warn('Seed Jobs API: Invalid locations format', typeof locations);
            return NextResponse.json({
                error: 'Invalid format',
                message: '"locations" must be an array of strings'
            }, { status: 400 });
        }
        // End Validation

        return await insertJobs(locations);

    } catch (error: any) {
        console.error('Seed Jobs API Critical Error:', error);
        return NextResponse.json({
            error: 'Internal Server Error',
            details: error.message
        }, { status: 500 });
    }
}

async function insertJobs(locations: string[]) {
    const client = await pool.connect();
    let successCount = 0;
    let failCount = 0;
    const errors: any[] = [];
    const successfulLocations: string[] = [];

    try {
        console.log(`Seed Jobs: Processing ${locations.length} locations...`);

        for (const loc of locations) {
            // Per-item validation
            if (typeof loc !== 'string' || loc.trim() === '') {
                console.warn(`Seed Jobs: Skipping invalid location: ${loc}`);
                failCount++;
                errors.push({ location: loc, error: 'Invalid string' });
                continue;
            }

            try {
                // Determine region_type based on format
                // Simple heuristic: If it's 5 digits, it's a zip. Otherwise treat as city/location.
                const isZip = /^\d{5}$/.test(loc.trim());
                const regionType = isZip ? 'zip' : 'city';

                // Check if exists pending or processing
                const check = await client.query(
                    `SELECT id FROM crawl_jobs WHERE region_value = $1 AND status IN ('pending', 'processing')`,
                    [loc]
                );

                if (check.rows.length === 0) {
                    await client.query(
                        `INSERT INTO crawl_jobs (region_type, region_value, status) VALUES ($1, $2, 'pending')`,
                        [regionType, loc]
                    );
                    successCount++;
                    successfulLocations.push(loc);
                } else {
                    console.log(`Seed Jobs: Location already pending/processing: ${loc}`);
                    // We don't count existing as 'fail', just not 'newly seeded'
                }
            } catch (dbErr: any) {
                console.error(`Seed Jobs: DB Error for ${loc}:`, dbErr);
                failCount++;
                errors.push({ location: loc, error: dbErr.message });
            }
        }

        console.log(`Seed Jobs Complete. Added: ${successCount}, Failed: ${failCount}`);

        return NextResponse.json({
            success: true,
            summary: {
                total_processed: locations.length,
                seeded_new: successCount,
                failed: failCount,
            },
            seeded_locations: successfulLocations,
            errors: errors.length > 0 ? errors : undefined
        });

    } finally {
        client.release();
    }
}
