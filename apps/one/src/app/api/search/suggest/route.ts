import { NextRequest, NextResponse } from 'next/server';
import { getSuggestions } from '@/lib/search-suggestions';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const q = request.nextUrl.searchParams.get('q') ?? '';
    const limitParam = parseInt(request.nextUrl.searchParams.get('limit') ?? '8', 10);
    const limit = isNaN(limitParam) ? 8 : Math.min(Math.max(1, limitParam), 20);

    if (!q.trim()) {
        return NextResponse.json({ suggestions: [] });
    }

    const suggestions = getSuggestions(q, limit);
    return NextResponse.json({ suggestions });
}
