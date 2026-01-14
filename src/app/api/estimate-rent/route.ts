import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import path from 'path';

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { lat, lon, beds, baths, sqft, year_built, zip_code } = body;

        if (!lat || !lon) {
            return NextResponse.json({ error: 'Missing lat/lon' }, { status: 400 });
        }

        // Construct arguments
        const args = [
            '--lat', String(lat),
            '--lon', String(lon),
        ];

        if (beds) args.push('--beds', String(beds));
        if (baths) args.push('--baths', String(baths));
        if (sqft) args.push('--sqft', String(sqft));
        if (year_built) args.push('--year_built', String(year_built));
        if (zip_code) args.push('--zip_code', String(zip_code));

        // Path to backend directory
        const backendDir = process.cwd() + '/_backend';

        // Use activation script and relative script name
        const command = `cd "${backendDir}" && source venv/bin/activate && python estimate_rent.py ${args.join(' ')}`;
        console.log("Executing command:", command);

        return new Promise<NextResponse>((resolve) => {
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    console.error(`Exec error: ${error}`);
                    console.error(`Stderr: ${stderr}`);
                    resolve(NextResponse.json({ error: 'Estimation failed', details: stderr }, { status: 500 }));
                    return;
                }

                try {
                    const result = JSON.parse(stdout.trim());
                    resolve(NextResponse.json(result));
                } catch (parseError) {
                    console.error(`Parse error: ${parseError}`);
                    resolve(NextResponse.json({ error: 'Invalid response from estimator', output: stdout }, { status: 500 }));
                }
            });
        });

    } catch (e) {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
