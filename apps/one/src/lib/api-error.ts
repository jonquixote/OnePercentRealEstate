export function safeErrorResponse(error: unknown, status = 500): Response {
  const isDev = process.env.NODE_ENV === 'development';
  const message = error instanceof Error ? error.message : 'Unknown error';
  return Response.json(
    { error: isDev ? message : 'Internal server error' },
    { status }
  );
}
