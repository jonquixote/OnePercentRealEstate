# Prod Resilience — Survive Reboots, OOMs, and IP Changes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On 2026-07-24 the single prod box OOM'd, rebooted, and came up with a wiped `/root/.ssh/authorized_keys` — a total SSH lockout that forced a snapshot→new-server rebuild and a DNS change, ~1h of downtime and manual `upctl` surgery. Every link in that chain was preventable. This plan removes the three failure modes it exposed: (1) SSH access that doesn't survive a reboot, (2) an OOM that can take the whole host down, and (3) a public IP that can't move, so any box change forces a DNS edit and propagation wait. Outcome: a reboot is a non-event, an OOM is contained to one service, and a box swap is zero-DNS.

**Architecture:** Persist the deploy key at three layers (authorized_keys, UpCloud stored SSH keys, and cloud-init user-data) so no reboot/rebuild can strip it. Contain memory with a swap increase, Postgres right-sizing, and systemd `MemoryHigh`/`MemoryMax` on every worker + a cgroup cap on the build step (the deploy's `pnpm build` runs on the live host and is a prime OOM trigger). Decouple the public address from the box with a UpCloud **floating IP** that DNS points at once, forever. Everything is captured in one idempotent `ops/` runbook script so the next incident is a command, not an improvisation.

**Tech Stack:** UpCloud (`upctl`), Ubuntu 24.04, systemd, Postgres 16, bash. No app code changes.

## Global Constraints

- **No destructive prod actions without a snapshot first.** Every task that touches the live box takes `upctl storage backup create` on the boot disk before mutating.
- **Idempotent + reversible.** Every script re-runs safely; every sysctl/systemd change is a file under `ops/` in git, never a one-off shell edit.
- **The deploy key is `ssh-ed25519 …WAFO onepercent-deploy-202606`** (public value); it must end up in all three durability layers.
- **Trial-account limits stand:** 24GB memory cap, custom plans blocked, `upctl server stop/start/modify` are classifier-gated (user runs those steps via `!`).
- **Postgres is the memory-critical process** — it must never be the OOM victim; workers/build are the acceptable casualties.
- **No secret values in git or the runbook** — the floating IP, key, and UUIDs are non-secret; passwords stay in `/root/.oper_*` and `.env`.
- **Verification is behavioral:** each task ends by proving the failure mode is gone (simulate a reboot, a memory spike, a box swap), not just that a file exists.

## Current State (verified 2026-07-24 on the new prod box `209.50.61.64`)

- Prod is the post-rescue box (UUID `003b1626`, 16GB, Ubuntu, us-sjo1). Old box `009821f6` stopped as fallback. Side scraper `003b3b44` stopped (needs restart).
- Memory: 15GB RAM, **4GB swapfile** (`/swapfile`, prio -1). Postgres `shared_buffers=2GB`, `work_mem=64MB`, `effective_cache_size=8GB`. `oper-worker` `MemoryMax=512M`, `oper-app` `MemoryMax=2G`. Several workers have no cap.
- SSH keys: `authorized_keys` is the ONLY layer (no UpCloud stored key, cloud-init re-injects only on a fresh instance-id) — a reboot that resets the file locks us out (root cause of the incident).
- Public IP `209.50.61.64` is `part_of_plan`, **not floating** — DNS (dns-parking.com / Hostinger) points `one`/`two.octavo.press` directly at it, so a box change requires a manual DNS edit.
- `ops/systemd/deploy-systemd.sh` runs `pnpm build` on the live host during every deploy (competes with the running stack for RAM).
- `gen-env.sh` passes through every `.env` key; systemd units copied to `/etc/systemd/system`.

## File Structure

| File | Responsibility |
|---|---|
| `ops/resilience/harden-memory.sh` (create) | Idempotent: swap sizing, `vm.swappiness`/`overcommit` sysctl, Postgres memory conf drop-in, `oom_score_adj` for postgres. |
| `ops/systemd/*.service` (modify) | Add `MemoryHigh`/`MemoryMax` to every worker; nice/ionice the build. |
| `ops/resilience/persist-ssh-key.sh` (create) | Write key to authorized_keys + register UpCloud stored key + drop cloud-init snippet. |
| `ops/resilience/attach-floating-ip.sh` (create) | Create/attach a floating IP, print the DNS target. |
| `ops/systemd/deploy-systemd.sh` (modify) | Run `pnpm build` under a `systemd-run --scope -p MemoryMax=` cap so a build can't OOM the host. |
| `documentation/operations/prod-rescue-runbook.md` (create) | The snapshot→restore→key→deploy→DNS sequence that worked, as a checklist + one script. |
| `ops/resilience/rescue.sh` (create) | Encodes the runbook: given a dead box, stand up a replacement from the latest snapshot. |

---

## Task 1: SSH key survives any reboot/rebuild

**Files:** create `ops/resilience/persist-ssh-key.sh`.

- [ ] **Step 1:** Script (idempotent) does three things: (a) ensure the pubkey is in `/root/.ssh/authorized_keys` (append-if-absent, `chmod 700 .ssh` / `600 authorized_keys`); (b) register it as a UpCloud **stored SSH key** on the account so `upctl server create --ssh-keys` and rebuilds always have it; (c) write `/etc/cloud/cloud.cfg.d/99-oper-keys.cfg` with `ssh_authorized_keys` + `ssh_deletekeys: false` and `preserve_hostname: true` so cloud-init on any boot re-adds (never strips) the key.
- [ ] **Step 2: Verify** — `cloud-init schema --config-file` validates the snippet; `grep` confirms the key in authorized_keys.
- [ ] **Step 3: Prove the failure mode is gone** — (user, via `!`) `upctl server restart` the box; after it returns, `ssh -i ~/.ssh/id_onepercent root@<ip> 'echo IN'` succeeds. (This is the exact scenario that locked us out.) Commit — `feat(resilience): triple-persist the deploy SSH key (authorized_keys + UpCloud + cloud-init)`

## Task 2: OOM containment — Postgres protected, workers + build capped

**Files:** create `ops/resilience/harden-memory.sh`; modify the worker `ops/systemd/*.service` units.

- [ ] **Step 1: Postgres conf drop-in** (`/etc/postgresql/16/main/conf.d/10-oper-mem.conf` or the box's PGDATA equivalent): keep `shared_buffers=2GB`, drop `work_mem` to `32MB` (64MB × parallel × connections was the spike surface), set `max_connections` to a sane bound, `maintenance_work_mem=256MB`. Reload (`SELECT pg_reload_conf()`), not restart.
- [ ] **Step 2: Protect Postgres from the OOM killer** — a systemd drop-in for the postgres unit with `OOMScoreAdjust=-800` (or set `oom_score_adj` on the postmaster) so the kernel kills a worker/build, never the DB.
- [ ] **Step 3: Cap every worker** — add `MemoryHigh` (soft, triggers reclaim) + `MemoryMax` (hard) to each `oper-worker*` unit (e.g. rent/refresh/watchlist/media/ml-scheduler/digest/alerts) sized to its role; the heaviest gets the most. `MemoryHigh` throttles before the hard kill.
- [ ] **Step 4: Swap headroom + sysctl** — grow `/swapfile` to 8GB (idempotent: skip if already ≥8GB), set `vm.swappiness=10`, `vm.overcommit_memory=2` + `overcommit_ratio` tuned so allocations fail gracefully instead of invoking the OOM killer. Persist in `/etc/sysctl.d/`.
- [ ] **Step 5: Prove containment** — run a controlled memory hog under a scope (`systemd-run --scope -p MemoryMax=200M stress-ng --vm ...`) and confirm it is the one killed, Postgres + app stay up (`systemctl is-active`), and the host does not reboot. Commit — `feat(resilience): OOM containment — pg protected/right-sized, workers capped, swap+sysctl`

## Task 3: Build can't OOM the host

**Files:** modify `ops/systemd/deploy-systemd.sh`.

- [ ] **Step 1:** Wrap the `pnpm build` step in `systemd-run --scope -p MemoryMax=6G -p MemoryHigh=5G --nice=10 --property=IOWeight=50 …` so a runaway build is reclaimed/killed inside its cgroup instead of taking the live stack down. Preserve the existing env-sourcing (`set -a; . ./.env`) inside the scope.
- [ ] **Step 2: Verify** — a deploy still succeeds end-to-end; during the build, `systemctl is-active oper-app oper-postgres` stays `active` (build no longer competes unbounded). Commit — `fix(ops): run deploy build under a memory-capped scope so it can't OOM prod`

## Task 4: Floating IP — box swaps become zero-DNS

**Files:** create `ops/resilience/attach-floating-ip.sh`.

- [ ] **Step 1:** Script: create a UpCloud floating IP in us-sjo1 (idempotent — reuse if one tagged `oper-prod` exists), attach it to the current prod box's public interface, and print the address as the single DNS target.
- [ ] **Step 2: Cutover (user does the DNS edit ONCE):** point `one`/`two.octavo.press` A records at the floating IP; from then on a box swap = `attach-floating-ip.sh <new-box>` with no DNS change.
- [ ] **Step 3: Verify** — `curl --resolve one.octavo.press:443:<floating-ip> https://one.octavo.press/api/health` returns 200 through the floating IP; document that future rescues reattach the float instead of editing DNS. Commit — `feat(resilience): floating IP for prod — DNS points at it once, box swaps stop touching DNS`

## Task 5: One-command rescue runbook

**Files:** create `documentation/operations/prod-rescue-runbook.md` + `ops/resilience/rescue.sh`.

- [ ] **Step 1: Runbook** — the exact 2026-07-24 sequence as a checklist: snapshot → (user) stop dead box → `create --plan PREMIUM-2xCPU-16GB --os <latest-snapshot> --enable-metadata --ssh-keys` → SSH verify data → `deploy-systemd.sh` → run out-of-band migrations → `attach-floating-ip.sh` (no DNS edit once Task 4 lands) → delete dead box. Include the trial-account gotchas (24GB cap, custom plans blocked, classifier-gated stops → run via `!`).
- [ ] **Step 2: `rescue.sh`** — encodes the automatable parts (snapshot, create-from-latest-snapshot, wait, verify SSH + `SELECT count(*) FROM listings`, deploy), pausing at the human-gated steps with the exact `!` command to paste.
- [ ] **Step 3: Verify** — dry-run `rescue.sh --plan-only` prints the full sequence with resolved UUIDs/IPs and makes no changes. Commit — `docs(ops): prod rescue runbook + rescue.sh (snapshot→restore→key→deploy→float)`

## Self-Review

**Spec coverage:** the reboot-lockout root cause is closed at three layers (T1) · OOM can no longer take the host — pg protected, workers/build capped, swap grown (T2, T3) · box swaps stop forcing DNS edits (T4) · the improvised rescue becomes a script (T5). Each task proves the failure mode is gone behaviorally. Covered.

**Placeholder scan:** every task names exact files, sysctl/systemd keys, and a behavioral verification (restart, memory-hog, floating-IP curl, dry-run). The human-gated steps are marked with the exact `!` command.

**Type consistency:** N/A (ops/config); the deploy key string, box UUIDs, and floating-IP target are the shared identifiers, defined once in the runbook and reused by the scripts.
