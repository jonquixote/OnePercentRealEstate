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
