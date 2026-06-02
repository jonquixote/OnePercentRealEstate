import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { z } from 'zod';
import { env } from '@/lib/env';
import { checkRateLimit, fetchRentalsLimiter } from '@/lib/rate-limit';

const fetchSchema = z.object({
  location: z.string().min(1).max(100),
  past_days: z.number().int().min(1).max(365).optional(),
});

function validateApiKey(req: Request): boolean {
  const apiKey = req.headers.get('x-api-key');
  return !!apiKey && apiKey === env.ADMIN_API_KEY;
}

export async function POST(req: Request) {
  if (!validateApiKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  const limit = await checkRateLimit(fetchRentalsLimiter, ip);
  if (!limit.allowed) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
      status: 429,
      headers: { 'Retry-After': String(limit.retryAfter || 30) },
    });
  }

  try {
    const body = await req.json();
    const parsed = fetchSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
    }

    const { location, past_days } = parsed.data;

    const backendDir = process.cwd() + '/_backend';
    const args = ['fetch_rental_comps.py', '--location', location];

    if (past_days !== undefined) args.push('--past_days', String(past_days));

    return new Promise<NextResponse>((resolve) => {
      execFile('python', args, {
        cwd: backendDir,
        timeout: 60000,
        env: {
          ...process.env,
          VIRTUAL_ENV: backendDir + '/venv',
          PATH: backendDir + '/venv/bin:' + process.env.PATH
        }
      }, (error, stdout, stderr) => {
        if (error) {
          console.error('Rental fetch execution failed:', error.message);
          resolve(NextResponse.json({ error: 'Fetch failed' }, { status: 500 }));
          return;
        }

        try {
          const lines = stdout.trim().split('\n');
          const lastLine = lines[lines.length - 1];
          const result = JSON.parse(lastLine);
          resolve(NextResponse.json(result));
        } catch (parseError) {
          console.error('Rental fetcher output parse error:', parseError);
          resolve(NextResponse.json({ error: 'Invalid response from fetcher' }, { status: 500 }));
        }
      });
    });
  } catch (e) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
