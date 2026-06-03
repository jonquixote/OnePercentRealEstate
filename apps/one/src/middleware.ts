// Middleware disabled - no Supabase auth
// To re-enable authentication, implement with NextAuth.js or similar

import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
    // Pass through all requests - no auth check
    return NextResponse.next();
}

export const config = {
    matcher: [
        '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
};
