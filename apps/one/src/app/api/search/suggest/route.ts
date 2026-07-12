import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSuggestions } from '@/lib/search-suggestions';
import { parseQuery, numericParam } from '@/lib/api-utils';

export const dynamic = 'force-dynamic';

const SuggestSchema = z.object({
  q: z.string().max(100, 'query too long').optional().default(''),
  limit: numericParam(1, 20).optional().default(8),
});

export async function GET(request: NextRequest) {
    const parsed = parseQuery(SuggestSchema, request);
    if (!parsed.ok) return parsed.response;

    const { q, limit } = parsed.data;

    if (!q.trim()) {
        return NextResponse.json({ suggestions: [] });
    }

    const suggestions = getSuggestions(q, limit);
    return NextResponse.json({ suggestions });
}
