import { NextRequest, NextResponse } from 'next/server';
import { getSuggestions } from '@/lib/search-suggestions';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const q = request.nextUrl.searchParams.get('q') ?? '';
    const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') ?? '8'), 20);

    if (!q.trim()) {
        return NextResponse.json({ suggestions: [] });
    }

    const suggestions = getSuggestions(q, limit);
    return NextResponse.json({ suggestions });
}
