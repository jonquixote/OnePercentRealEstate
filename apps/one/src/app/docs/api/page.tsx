import Link from 'next/link';

export const metadata = {
  title: 'Partner API | OnePercent',
  description: 'Programmatic access to OnePercent listings via bearer-authenticated API keys.',
};

const EXAMPLES: { title: string; prose: string; code: string }[] = [
  {
    title: '1. Create an API key (Pro only)',
    prose:
      'Keys are created from an authenticated session. Save the cookie from login, then POST to /api/v1/keys. The plaintext key is returned exactly once — store it somewhere safe.',
    code: `curl -c cookiejar.txt -X POST https://one.octavo.press/api/auth/login \\
  -H 'Content-Type: application/json' \\
  -d '{"email":"you@example.com","password":"..."}'

curl -b cookiejar.txt -X POST https://one.octavo.press/api/v1/keys \\
  -H 'Content-Type: application/json' \\
  -d '{"name":"my-partner-app"}'
# => { "id": 1, "name": "my-partner-app", "key": "opk_...", "created_at": "..." }`,
  },
  {
    title: '2. List listings with your key',
    prose:
      'Pass the key as a Bearer token. The filter language is the same query language used in the terminal.',
    code: `curl -H 'Authorization: Bearer opk_...' \\
  'https://one.octavo.press/api/v1/listings?filter=rent_price_ratio >= 0.01'`,
  },
  {
    title: '3. A more complex filter',
    prose:
      'Combine predicates with AND / OR. The filter is re-compiled server-side and parameterized — never interpolated as raw SQL.',
    code: `curl -H 'Authorization: Bearer opk_...' \\
  'https://one.octavo.press/api/v1/listings?filter=price_cut_pct > 0.05 AND rent_price_ratio >= 0.01'`,
  },
  {
    title: '4. Non-Pro owner → 403',
    prose:
      'API keys are Pro-only. If the key belongs to a free-tier account the endpoint returns PRO_REQUIRED.',
    code: `curl -i -H 'Authorization: Bearer opk_free_tier_key' \\
  'https://one.octavo.press/api/v1/listings?filter=rent_price_ratio >= 0.01'
# => 403 {"error":"PRO_REQUIRED"}`,
  },
  {
    title: '5. Revoked (or invalid) key → 401',
    prose:
      'A revoked key — or any key that does not match a stored hash — is rejected with 401. Rotate keys from /api/v1/keys (DELETE ?id=).',
    code: `curl -i -H 'Authorization: Bearer opk_revoked_or_bogus' \\
  'https://one.octavo.press/api/v1/listings?filter=rent_price_ratio >= 0.01'
# => 401 {"error":"invalid or revoked API key"}`,
  },
];

export default function ApiDocsPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: 'var(--font-fraunces)' }}>
        Partner API
      </h1>
      <p className="mt-3 text-[15px] text-haze leading-relaxed">
        Programmatic, read-only access to OnePercent listings. API keys are a
        Pro-only feature and are authenticated with a Bearer token. The{' '}
        <code>/api/v1/</code> surface is rate-limited at 30 requests/second per IP
        (burst 60) via the shared nginx <code>api</code> zone. Keys are stored only
        as a SHA-256 hash — the plaintext is shown once at creation and never
        persisted.
      </p>

      <div
        className="mt-6 rounded-md px-4 py-3 text-sm"
        style={{
          border: '1px solid color-mix(in srgb, var(--brass-hi) 40%, transparent)',
          background: 'color-mix(in srgb, var(--brass-hi) 10%, transparent)',
          color: 'var(--brass-hi)',
        }}
      >
        <strong>Pro only.</strong> Keys are tied to your account tier. A key owned
        by a free-tier user returns <code>403 PRO_REQUIRED</code>. Pro requests are
        capped at 1000 rows per call.
      </div>

      <h2 className="mt-10 text-xl font-semibold">Endpoints</h2>
      <ul className="mt-3 space-y-2 text-[15px] text-haze">
        <li>
          <code>POST /api/v1/keys</code> — create a key (session auth, Pro only)
        </li>
        <li>
          <code>GET /api/v1/keys</code> — list your keys (never returns the hash)
        </li>
        <li>
          <code>DELETE /api/v1/keys?id=N</code> — revoke a key you own
        </li>
        <li>
          <code>GET /api/v1/listings?filter=&lt;query&gt;</code> — Bearer-auth
          listings query (Pro only)
        </li>
      </ul>

      <h2 className="mt-10 text-xl font-semibold">Examples</h2>
      <div className="mt-4 space-y-8">
        {EXAMPLES.map((ex) => (
          <section key={ex.title}>
            <h3 className="text-base font-semibold">{ex.title}</h3>
            <p className="mt-1 text-[14px] text-haze leading-relaxed">{ex.prose}</p>
            <pre
              className="mt-3 overflow-x-auto rounded-md p-4 text-[13px] leading-relaxed"
              style={{
                fontFamily: 'var(--font-jetbrains)',
                background: 'color-mix(in srgb, var(--ink) 90%, #000)',
                border: '1px solid color-mix(in srgb, var(--haze) 25%, transparent)',
              }}
            >
              <code>{ex.code}</code>
            </pre>
          </section>
        ))}
      </div>

      <p className="mt-10 text-[14px] text-haze">
        Back to the <Link href="/" className="underline">terminal</Link>.
      </p>
    </div>
  );
}
