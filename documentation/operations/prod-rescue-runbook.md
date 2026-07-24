# Prod Rescue Runbook

## Context

On 2026-07-24, production box (`009821f6`, 16GB RAM, Ubuntu, us-sjo1) OOM'd, rebooted, wiped `/root/.ssh/authorized_keys`, and locked the operator out. Recovery required a snapshot-based rebuild to a new server (`003b1626`), DNS cutover, and ~1h downtime. This runbook captures the exact rescue sequence for future incidents.

The old dead box (`009821f6`) is stopped as fallback. Side scraper (`003b3b44`) is stopped and needs restart separately.

## Prerequisites

- `upctl` CLI authenticated (`! upctl server list`)
- Deploy SSH public key available (or `~/.ssh/id_onepercent.pub`)
- Access to this repo on the operator machine (for `ops/resilience/` scripts)
- DNS control for `one.octavo.press` and `two.octavo.press`

## Trial-Account Gotchas

- **24GB memory cap** — cannot exceed 24GB across all servers
- **Custom plans blocked** — must use stock plans (PREMIUM-2xCPU-16GB)
- **`upctl server stop/start/modify` are classifier-gated** — run via `!` prefix (operator manual execution)

## Rescue Sequence

### 1. Snapshot the dead box's boot disk

```bash
upctl server show 009821f6 --output json | jq '.storage_devices[] | select(.type=="disk") | {uuid, address, size}'
upctl server storage snapshot <boot-disk-uuid> --description "rescue-$(date +%Y%m%d-%H%M)"
```

> **Note:** If the dead box's disk is no longer available, skip to step 3 and use the latest snapshot from the backup list: `upctl server storage list 009821f6`

### 2. [USER] Stop the dead box

> **Classifier-gated** — paste this into your shell with `!` prefix:

```
! upctl server stop 009821f6
```

Verify it's stopped:

```bash
upctl server show 009821f6 --output json | jq '.state'
# Expected: "stopped"
```

### 3. Create new server from latest snapshot

```bash
# Find latest snapshot
upctl server storage list 009821f6 --output json | jq 'sort_by(.created_at) | last | .uuid'

# Create rescue server
upctl server create \
  --plan PREMIUM-2xCPU-16GB \
  --os <latest-snapshot-uuid> \
  --enable-metadata \
  --ssh-keys onepercent-deploy-202606 \
  --name oper-prod-rescue \
  --zone us-sjo1
```

Save the new server UUID from the output.

### 4. Wait for server to be running, verify SSH access

```bash
NEW_UUID="<new-server-uuid>"
NEW_IP=$(upctl server show "$NEW_UUID" --output json | jq -r '.ip_addresses[] | select(.type=="public") | .address')

# Wait for SSH (timeout 120s)
for i in $(seq 1 40); do
  ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no root@"$NEW_IP" 'echo ok' && break
  echo "Waiting for SSH... ($i/40)"
  sleep 3
done
```

### 5. Verify data

```bash
ssh root@"$NEW_IP" 'psql -U postgres -d onepercent -c "SELECT count(*) FROM listings"'
```

> **Expected:** a positive count. If table is missing or zero, the snapshot was bad — stop here and investigate.

### 6. Deploy

```bash
ssh root@"$NEW_IP" 'bash -s' < ops/systemd/deploy-systemd.sh
```

### 7. Run out-of-band migrations (if any)

Check `infrastructure/migrations/` for any pending migrations not yet applied. Apply via psql.

### 8. Attach floating IP

```bash
ssh root@"$NEW_IP" 'bash -s' < ops/resilience/attach-floating-ip.sh "$NEW_UUID"
```

> **DNS cutover (ONE-TIME):** If this is the first time setting up the floating IP, update A records:
> - `one.octavo.press` → floating IP
> - `two.octavo.press` → floating IP
>
> After this, box swaps only require reattaching the float — no DNS edits.

### 9. Persist SSH key

```bash
ssh root@"$NEW_IP" 'bash -s' < ops/resilience/persist-ssh-key.sh
```

### 10. Harden memory

```bash
ssh root@"$NEW_IP" 'bash -s' < ops/resilience/harden-memory.sh
```

### 11. [USER] Delete dead box (optional, after verifying new box is stable)

> **Classifier-gated** — paste this into your shell with `!` prefix:

```
! upctl server delete 009821f6
```

> **Warning:** Only delete after the new box has been stable for at least 24h. The old box serves as fallback.

### 12. Restart side scraper (if needed)

```bash
! upctl server start 003b3b44
```

## Post-Rescue Verification

```bash
# Health check
curl -s https://one.octavo.press/api/health | jq .

# Map tiles
curl -sI "https://one.octavo.press/api/tiles/0/0/0.mvt"

# Listings count
ssh root@"$NEW_IP" 'psql -U postgres -d onepercent -c "SELECT count(*) FROM listings WHERE status = '\''active'\''"'
```

## Key UUIDs

| Entity | UUID | Status |
|--------|------|--------|
| Current prod | `003b1626` | Running |
| Old dead box | `009821f6` | Stopped (fallback) |
| Side scraper | `003b3b44` | Stopped |
