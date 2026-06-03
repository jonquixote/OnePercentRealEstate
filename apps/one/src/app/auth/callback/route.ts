import { type NextRequest, NextResponse } from 'next/server';

// Auth callback disabled - no Supabase auth
// To re-enable authentication, implement with NextAuth.js
export async function GET(request: NextRequest) {
    const { origin } = new URL(request.url);
    // Redirect to home since auth is disabled
    return NextResponse.redirect(`${origin}/`);
}
