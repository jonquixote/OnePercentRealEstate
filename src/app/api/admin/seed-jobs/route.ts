import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function POST(req: Request) {
    try {
        const { locations } = await req.json(); // Expect { "locations": ["Cleveland, OH", ...] }

        if (!locations || !Array.isArray(locations)) {
            // Default list if none provided
            const defaultLocations = [
                "Cleveland, OH",
                "Indianapolis, IN",
                "Tampa, FL",
                "Kansas City, MO",
                "Charlotte, NC",
                "Columbus, OH",
                "Austin, TX",
                "Miami, FL",
                "Atlanta, GA"
            ];
            return await insertJobs(defaultLocations);
        }

        return await insertJobs(locations);

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

async function insertJobs(locations: string[]) {
    const client = await pool.connect();
    try {
        let count = 0;
        for (const loc of locations) {
            // Check if exists pending or processing
            const check = await client.query(
                `SELECT id FROM crawl_jobs WHERE region_value = $1 AND status IN ('pending', 'processing')`,
                [loc]
            );

            if (check.rows.length === 0) {
                await client.query(
                    `INSERT INTO crawl_jobs (region_type, region_value, status) VALUES ('zip', $1, 'pending')`,
                    [loc]
                );
                count++;
            }
        }
        return NextResponse.json({ success: true, seeded: count, locations });
    } finally {
        client.release();
    }
}
