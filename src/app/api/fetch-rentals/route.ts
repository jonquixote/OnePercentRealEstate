import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import path from 'path';

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { location, past_days } = body;

        if (!location) {
            return NextResponse.json({ error: 'Location is required' }, { status: 400 });
        }

        // Construct command arguments
        let args = `--location "${location}"`;
        if (past_days) args += ` --past_days ${past_days}`;

        // Path to backend directory
        const backendDir = process.cwd() + '/_backend';

        // Use activation script and relative script name
        const command = `cd "${backendDir}" && source venv/bin/activate && python fetch_rental_comps.py ${args}`;

        return new Promise<NextResponse>((resolve) => {
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    console.error(`Exec error: ${error}`);
                    console.error(`Stderr: ${stderr}`);
                    resolve(NextResponse.json({ error: 'Fetch failed', details: stderr }, { status: 500 }));
                    return;
                }

                try {
                    // The script prints JSON at the end
                    const lines = stdout.trim().split('\n');
                    const lastLine = lines[lines.length - 1];
                    const result = JSON.parse(lastLine);
                    resolve(NextResponse.json(result));
                } catch (parseError) {
                    console.error(`Parse error: ${parseError}`);
                    resolve(NextResponse.json({ error: 'Invalid response from fetcher', output: stdout }, { status: 500 }));
                }
            });
        });

    } catch (e) {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
