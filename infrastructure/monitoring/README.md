# Monitoring stack

Configuration for a Prometheus + Alertmanager + Grafana stack that
sits alongside the main app stack. **Not yet wired into
`infrastructure/docker-compose.yml`** — see "Wiring it in" below for
the compose snippet to add when ready.

For broader infrastructure context, read
[`documentation/operations/vps_deployment_guide.md`](../../documentation/operations/vps_deployment_guide.md).

## What's here

```
infrastructure/monitoring/
├── alertmanager/
│   └── alertmanager.yml             # routes + receivers
├── grafana/
│   ├── dashboards/
│   │   └── system.json              # starter system dashboard
│   └── provisioning/
│       └── datasources/
│           └── prometheus.yml       # auto-provisioned datasource
├── prometheus/
│   ├── prometheus.yml               # scrape config
│   └── rules/
│       └── alerts.yml               # alert rules
└── README.md                        # this file
```

## What's expected on the host

The scrape config in `prometheus.yml` assumes these exporters are
running:

| Exporter           | Where                     | How to install                                                                          |
| ------------------ | ------------------------- | --------------------------------------------------------------------------------------- |
| node-exporter      | host (port 9100)          | `apt-get install -y prometheus-node-exporter`                                           |
| cadvisor           | container (port 8080)     | new compose service (see below)                                                         |
| postgres-exporter  | container (port 9187)     | new compose service, env `DATA_SOURCE_NAME=postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/postgres?sslmode=disable` |
| redis-exporter     | container (port 9121)     | new compose service, env `REDIS_ADDR=redis://redis:6379` and `REDIS_PASSWORD=${REDIS_PASSWORD}` |

The Next.js metrics jobs (commented in `prometheus.yml`) wait on
prom-client instrumentation in `apps/one` and `apps/two`. Wave 7 owns
the scaffolding only — the wiring lands in a follow-up.

## Wiring it in

Append to `infrastructure/docker-compose.yml`:

```yaml
  prometheus:
    image: prom/prometheus:v2.54.1
    restart: always
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - ./monitoring/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - ./monitoring/prometheus/rules:/etc/prometheus/rules:ro
      - prometheus_data:/prometheus
    command:
      - "--config.file=/etc/prometheus/prometheus.yml"
      - "--storage.tsdb.path=/prometheus"
      - "--storage.tsdb.retention.time=30d"
      - "--web.enable-lifecycle"
    ports:
      - "127.0.0.1:9090:9090"
    networks:
      - backend
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  alertmanager:
    image: prom/alertmanager:v0.27.0
    restart: always
    volumes:
      - ./monitoring/alertmanager/alertmanager.yml:/etc/alertmanager/alertmanager.yml:ro
      - alertmanager_data:/alertmanager
    ports:
      - "127.0.0.1:9093:9093"
    networks:
      - backend

  cadvisor:
    image: gcr.io/cadvisor/cadvisor:v0.49.1
    restart: always
    privileged: true
    devices:
      - /dev/kmsg
    volumes:
      - /:/rootfs:ro
      - /var/run:/var/run:ro
      - /sys:/sys:ro
      - /var/lib/docker/:/var/lib/docker:ro
      - /dev/disk/:/dev/disk:ro
    ports:
      - "127.0.0.1:8080:8080"
    networks:
      - backend

  postgres-exporter:
    image: quay.io/prometheuscommunity/postgres-exporter:v0.15.0
    restart: always
    environment:
      DATA_SOURCE_NAME: "postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/postgres?sslmode=disable"
      PG_EXPORTER_EXTEND_QUERY_PATH: /etc/postgres-exporter/queries.yml
    volumes:
      - ./monitoring/postgres-exporter/queries.yml:/etc/postgres-exporter/queries.yml:ro
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - backend

  redis-exporter:
    image: oliver006/redis_exporter:v1.62.0
    restart: always
    environment:
      REDIS_ADDR: "redis://redis:6379"
      REDIS_PASSWORD: ${REDIS_PASSWORD}
    depends_on:
      redis:
        condition: service_healthy
    networks:
      - backend

  grafana:
    image: grafana/grafana:11.2.0
    restart: always
    environment:
      GF_SECURITY_ADMIN_USER: ${GRAFANA_ADMIN_USER:-admin}
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_ADMIN_PASSWORD}
      GF_USERS_ALLOW_SIGN_UP: "false"
      GF_SERVER_ROOT_URL: "https://grafana.octavo.press"
    volumes:
      - ./monitoring/grafana/provisioning:/etc/grafana/provisioning:ro
      - ./monitoring/grafana/dashboards:/var/lib/grafana/dashboards:ro
      - grafana_data:/var/lib/grafana
    ports:
      - "127.0.0.1:3002:3000"
    depends_on:
      - prometheus
    networks:
      - backend

# Also append to the top-level volumes: block
#   prometheus_data:
#   alertmanager_data:
#   grafana_data:
```

Add a custom queries file (referenced by the postgres-exporter snippet
above) at `infrastructure/monitoring/postgres-exporter/queries.yml`
with the `crawl_jobs` query at the bottom of
`prometheus/rules/alerts.yml`.

## Env vars to add to `.env`

```ini
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=<generate with: openssl rand -base64 24>
ALERTMANAGER_SMTP_HOST=smtp.fastmail.com:465
ALERTMANAGER_SMTP_FROM=alerts@octavo.press
ALERTMANAGER_SMTP_USER=alerts@octavo.press
ALERTMANAGER_SMTP_PASSWORD=<smtp app password>
ALERTMANAGER_SMTP_TO=ops@octavo.press
ALERTMANAGER_SLACK_WEBHOOK_URL=          # optional, leave blank to disable slack
```

`alertmanager.yml` still has placeholder strings (`REPLACE_WITH_...`)
because alertmanager's config doesn't natively support env-var
substitution. The cleanest path is to `envsubst` the file at container
startup; see the `command:` override pattern in
<https://github.com/prometheus/alertmanager/issues/504>.

## nginx for grafana

Add a `grafana.octavo.press` site mirroring the `n8n.octavo.press`
config — basic-auth in front, `proxy_pass http://127.0.0.1:3002`,
WebSocket upgrade headers from `snippets/proxy-params.conf`.

## Verification after first deploy

```bash
ssh onepercent-prod "docker ps | grep -E 'prom|grafana|cadvisor|exporter'"
curl -s http://127.0.0.1:9090/-/ready    # prometheus
curl -s http://127.0.0.1:9093/-/ready    # alertmanager
curl -s -u admin:<GRAFANA_ADMIN_PASSWORD> http://127.0.0.1:3002/api/health
```

The starter dashboard at `grafana/dashboards/system.json` is
intentionally minimal. Once the stack is running, import community
dashboards by ID:

| ID    | What                              |
| ----- | --------------------------------- |
| 1860  | Node Exporter Full                |
| 893   | Docker and system monitoring (cadvisor) |
| 9628  | PostgreSQL Database (postgres-exporter) |
| 763   | Redis Dashboard                   |

Curated app-level dashboards (HTTP latency by route, scraper
throughput) come later — track in
`documentation/operations/wave-7-open-items.md`.
