# nginx config (versioned — A1, backend-db-hardening)

Source of truth for the edge. The live files on the server are DEPLOYED
COPIES of these; never edit /etc/nginx directly.

Layout → server mapping:
  conf.d/oper-ratelimit.conf → /etc/nginx/conf.d/oper-ratelimit.conf
  snippets/*.conf            → /etc/nginx/snippets/
  sites/*                    → /etc/nginx/sites-available/ (symlinked in sites-enabled)

Deploy:
  scp ops/nginx/conf.d/oper-ratelimit.conf root@SERVER:/etc/nginx/conf.d/
  scp ops/nginx/snippets/*.conf root@SERVER:/etc/nginx/snippets/
  scp ops/nginx/sites/one.octavo.press root@SERVER:/etc/nginx/sites-available/one.octavo.press
  scp ops/nginx/sites/two.octavo.press root@SERVER:/etc/nginx/sites-available/two.octavo.press
  ssh root@SERVER 'nginx -t && systemctl reload nginx'

Rate limits (zones in conf.d, applied in sites/ + tiles snippet):
  /api/auth/  5 r/min  burst 5   — brute-force protection → 429
  /api/       30 r/s   burst 60  — app chatter headroom
  /tiles/     100 r/s  burst 200 — map panning is bursty by design

Notes:
- `$connection_upgrade` map comes from nginx.conf defaults on Ubuntu
  (map $http_upgrade $connection_upgrade) — if a fresh box lacks it, add
  the map block to conf.d.
- Certbot manages the ssl_certificate lines; a certbot renew may rewrite
  the live files — diff against this directory after renewals
  (`diff <(ssh root@SERVER cat /etc/nginx/sites-enabled/one.octavo.press) ops/nginx/sites/one.octavo.press`).
- n8n.octavo.press + the default site are intentionally not versioned here
  (stock certbot/nginx boilerplate, no app logic).

## GeoIP headers (near-you features)

Injects `x-geo-latitude` / `x-geo-longitude` / `x-geo-city` into every proxied
request from the client IP via the `libnginx-mod-http-geoip2` module + the
free DB-IP City Lite mmdb. The app (`metroFromHeaders`) prefers these over the
`x-vercel-ip-*` preview headers and treats empty/malformed as no-geo.

**Spoof-proof:** `proxy_set_header` overwrites any client-supplied `x-geo-*`
on the way in, so a visitor can never forge their metro.

Deploy (one-time + each mmdb refresh):
  apt-get install -y libnginx-mod-http-geoip2       # loads via /etc/nginx/modules-enabled
  mkdir -p /var/lib/geoip
  curl -fsSL "https://download.db-ip.com/free/dbip-city-lite-$(date +%Y-%m).mmdb.gz" \
    | gunzip > /var/lib/geoip/dbip-city-lite.mmdb
  install -m644 ops/nginx/geoip2.conf /etc/nginx/conf.d/geoip2.conf
  install -m644 ops/nginx/snippets/geo-headers.conf /etc/nginx/snippets/geo-headers.conf
  # In ops/nginx/sites/one.octavo.press: add `include snippets/geo-headers.conf;`
  # inside EACH proxied location (/api/auth/, /api/, /) — right after the
  # existing `include snippets/proxy-params.conf;`.
  scp ops/nginx/conf.d/geoip2.conf root@SERVER:/etc/nginx/conf.d/
  scp ops/nginx/snippets/geo-headers.conf root@SERVER:/etc/nginx/snippets/
  scp ops/nginx/sites/one.octavo.press root@SERVER:/etc/nginx/sites-available/one.octavo.press
  ssh root@SERVER 'nginx -t && systemctl reload nginx'

Verify (from any box): `curl -s https://one.octavo.press/api/spotlight | jq .metro`
  → from a non-Houston IP the metro label should reflect the caller's geo once
  Tasks 2-3 ship. And a spoofed `x-geo-latitude` header must be IGNORED
  (nginx overwrites it).

Monthly mmdb refresh: re-run the `curl | gunzip` line (a systemd timer can be
added later; for now it's a manual cron). `auto_reload 24h` in geoip2.conf
picks up the new file without a reload.
