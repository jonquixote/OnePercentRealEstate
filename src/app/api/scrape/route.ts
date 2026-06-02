import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { z } from 'zod';
import { env } from '@/lib/env';
import { checkRateLimit, scrapeLimiter } from '@/lib/rate-limit';

const scrapeSchema = z.object({
  location: z.string().min(1).max(100),
  minPrice: z.number().min(0).optional(),
  maxPrice: z.number().min(0).optional(),
  beds: z.number().int().min(0).max(20).optional(),
  baths: z.number().int().min(0).max(20).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
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
  const limit = await checkRateLimit(scrapeLimiter, ip);
  if (!limit.allowed) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
      status: 429,
      headers: { 'Retry-After': String(limit.retryAfter || 30) },
    });
  }

  try {
    const body = await req.json();
    const parsed = scrapeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
    }

    const { location, minPrice, maxPrice, beds, baths, limit } = parsed.data;

    const backendDir = process.cwd() + '/_backend';
    const args = ['scraper.py', '--location', location];

    if (minPrice !== undefined) args.push('--min_price', String(minPrice));
    if (maxPrice !== undefined) args.push('--max_price', String(maxPrice));
    if (beds !== undefined) args.push('--beds', String(beds));
    if (baths !== undefined) args.push('--baths', String(baths));
    if (limit !== undefined) args.push('--limit', String(limit));

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
          console.error('Scraper execution failed:', error.message);
          resolve(NextResponse.json({ error: 'Scraping failed' }, { status: 500 }));
          return;
        }

        try {
          const result = JSON.parse(stdout.trim());
          resolve(NextResponse.json(result));
        } catch (parseError) {
          console.error('Scraper output parse error:', parseError);
          resolve(NextResponse.json({ error: 'Invalid response from scraper' }, { status: 500 }));
        }
      });
    });
  } catch (e) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
