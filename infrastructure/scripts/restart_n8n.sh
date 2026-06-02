#!/bin/bash
set -e
cd /opt/onepercent
set -a; source .env; set +a
echo "--- N8N_PASSWORD set: ${N8N_PASSWORD:+yes} (len=${#N8N_PASSWORD})"

echo "--- up n8n ---"
./infrastructure/deploy.sh up -d n8n 2>&1 | tail -10

echo "--- wait for n8n healthy ---"
for i in $(seq 1 30); do
  status=$(docker inspect --format="{{.State.Health.Status}}" infrastructure-n8n-1 2>/dev/null || echo "missing")
  echo "attempt $i: $status"
  if [ "$status" = "healthy" ]; then break; fi
  sleep 3
done

echo "--- verify N8N_BASIC_AUTH env in container ---"
docker exec infrastructure-n8n--1 printenv 2>/dev/null | grep -E "N8N_BASIC|N8N_USER" || \
  docker exec infrastructure-n8n-1 printenv 2>/dev/null | grep -E "N8N_BASIC|N8N_USER" || \
  echo "could not exec into n8n container"

echo "--- test /rest/login (no creds -> 401) ---"
curl -sI http://127.0.0.1:5678/rest/login | head -2

echo "--- login as admin@octavo.press ---"
curl -s -X POST -u "admin:${N8N_PASSWORD}" -H "Content-Type: application/json" \
  http://127.0.0.1:5678/rest/login \
  -d "{\"emailOrLdapLoginId\":\"admin@octavo.press\",\"password\":\"${N8N_PASSWORD}\"}" | head -c 600
echo
