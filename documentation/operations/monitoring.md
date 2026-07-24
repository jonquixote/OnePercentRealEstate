# Monitoring & Observability Reference

## Health Endpoint

`GET /api/health` on port 3001 returns:

```json
{
  "status": "ok|degraded",
  "db": "up|down",
  "redis": "up|down",
  "buildId": "...",
  "uptimeMs": 12345
}
```

- **DB check**: `SELECT 1` with 2s timeout
- **Redis check**: best-effort `PING` with 2s timeout
- HTTP 200 when `status: "ok"`, HTTP 503 when `status: "degraded"`

## Host & Service Healthcheck (`oper-healthcheck.timer`)

Runs every 2 minutes. Checks:

| Check | Threshold | Alert Key |
|-------|-----------|-----------|
| Memory available | < 10% of total | `mem-available` |
| Swap used | > 75% | `swap-used` |
| Disk `/` | > 85% used | `disk-root` |
| `oper-*` units | `is-active` | `unit-<name>` |
| HTTP health (port 3001) | `status:ok` | `http-app` |
| oper-two (port 3002) | HTTP 200 | `http-two` |

### Silencing during maintenance

```bash
# Prevent alerts for a specific check during maintenance:
touch /run/oper-alerts/<check-key>
# Or set a future timestamp to re-enable after N seconds:
echo $(($(date +%s) + 3600)) > /run/oper-alerts/<check-key>
```

## Telegram Alerts (`notify-telegram.sh`)

Deduped notifications via the existing `TELEGRAM_BOT_TOKEN` / `ALERTMANAGER_TELEGRAM_CHAT_ID` credentials.

- **Cooldown**: 30 minutes per key (same alert won't re-send within this window)
- **RESOLVED**: when a check passes after being in alert, a RESOLVED message is sent
- **State files**: `/run/oper-alerts/<key>`

## Post-Deploy Smoke Gate (`deploy-systemd.sh`)

Runs after every deploy. Fail-closed: any failure = non-zero exit.

| Surface | Check |
|---------|-------|
| `/api/health` | `status:ok` in JSON response |
| `/sitemap.xml` | Content-Type XML + `<urlset>` in body |
| `/robots.txt` | Contains `Disallow` |
| `oper-two` (port 3002) | HTTP 200 |

Failed smoke tests alert via Telegram with key `smoke-<check>`.

## Automated Snapshots (`oper-snapshot.timer`)

- **Schedule**: daily at 04:30 UTC
- **Command**: `upctl storage backup create <boot-disk> --description oper-auto-YYYY-MM-DD`
- **Retention**: keeps all snapshots within 30 days, minimum 3 newest always kept
- **Pruning**: oldest `oper-auto-*` backups older than 30 days are deleted, but never fewer than 3

### Monthly Restore Drill

Perform monthly to verify backups are restorable:

```bash
# 1. List available snapshots
upctl server storage list 003b1626 --output json | jq '[.[] | select(.description | startswith("oper-auto-"))] | sort_by(.created_at) | reverse | .[0]'

# 2. Create a throwaway server from the latest snapshot
SNAP_UUID=<snapshot-uuid-from-above>
THROWAWAY=$(upctl server create \
  --title "drill-$(date +%F)" \
  --hostname "drill-$(date +%F)" \
  --zone us-sjo1 \
  --plan 2xCPU-4GB \
  --os "Ubuntu Linux 24.04" \
  --storage "$SNAP_UUID" \
  --output json | jq -r '.uuid')

# 3. Wait for server to boot, then SSH in
upctl server wait $THROWAWAY --timeout 300
IP=$(upctl server show $THROWAWAY --output json | jq -r '.ip_addresses[0].address')
ssh root@$IP

# 4. Inside the throwaway box — verify data
sudo -u postgres psql -d onepercent -c "SELECT count(*) FROM listings;"
# Should return a non-zero count

# 5. Destroy the throwaway (always clean up)
exit
upctl server stop $THROWAWAY
upctl server delete $THROWAWAY --delete-storages
```

If the restore fails or data is missing, investigate immediately — your backups may be corrupt.
