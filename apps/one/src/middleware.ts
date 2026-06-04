// Middleware: propagates x-request-id end to end.
//
// Wave 2 adds: every request gets an x-request-id (preserved if the
// caller supplied one) that's mirrored back in the response and is
// available to server code via the inbound request headers. OTel
// spans pick up the OTel traceparent (handled by @vercel/otel), so the
// request id is for log correlation specifically — `grep <request_id>`
// across the app + worker logs is the workflow.

import { NextResponse, type NextRequest } from 'next/server';

const REQUEST_ID_HEADER = 'x-request-id';

function generateRequestId(): string {
    // Cheap, dependency-free. Format: r_<unix ms base36>_<rand5>.
    // Not crypto-grade — fine for log correlation only.
    const rand = Math.random().toString(36).slice(2, 7);
    return `r_${Date.now().toString(36)}_${rand}`;
}

export async function middleware(request: NextRequest) {
    const inbound = request.headers.get(REQUEST_ID_HEADER);
    const requestId = inbound && inbound.length > 0 && inbound.length < 128
        ? inbound
        : generateRequestId();

    // Forward the id to downstream handlers via a request header rewrite.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set(REQUEST_ID_HEADER, requestId);

    const response = NextResponse.next({
        request: { headers: requestHeaders },
    });

    // Mirror back to the client so they can correlate too.
    response.headers.set(REQUEST_ID_HEADER, requestId);

    return response;
}

export const config = {
    // We DO want middleware to run on /api routes now — that's where
    // request-id propagation matters most. We still skip the noisy
    // static asset paths.
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
};
