import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import path from 'path';

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { location, minPrice, maxPrice, beds, baths, limit } = body;

        if (!location) {
            return NextResponse.json({ error: 'Location is required' }, { status: 400 });
        }

        // Construct command arguments
        let args = `--location "${location}"`;
        if (minPrice) args += ` --min_price ${minPrice}`;
        if (maxPrice) args += ` --max_price ${maxPrice}`;
        if (beds) args += ` --beds ${beds}`;
        if (baths) args += ` --baths ${baths}`;
        if (limit !== undefined) args += ` --limit ${limit}`;

        // Path to backend directory
        const backendDir = process.cwd() + '/_backend';

        // Use activation script and relative script name
        const command = `cd "${backendDir}" && source venv/bin/activate && python scraper.py ${args}`;

        console.log(`Executing: ${command}`);

        return new Promise<NextResponse>((resolve) => {
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    console.error(`Exec error: ${error}`);
                    console.error(`Stderr: ${stderr}`);
                    resolve(NextResponse.json({ error: 'Scraping failed', details: stderr }, { status: 500 }));
                    return;
                }

                try {
                    // Parse the JSON output from the python script
                    // The script might print other things, so we look for the last line or try to parse stdout
                    const result = JSON.parse(stdout.trim());
                    resolve(NextResponse.json(result));
                } catch (parseError) {
                    console.error(`Parse error: ${parseError}`);
                    console.log(`Stdout: ${stdout}`);
                    resolve(NextResponse.json({ error: 'Invalid response from scraper', output: stdout }, { status: 500 }));
                }
            });
        });

    } catch (e) {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
