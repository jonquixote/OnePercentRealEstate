#!/bin/bash
set -e
cd /opt/onepercent
set -a; source .env; set +a

echo "--- stop n8n ---"
./infrastructure/deploy.sh stop n8n 2>&1 | tail -2
sleep 5

echo "--- import credential ---"
docker run --rm --network infrastructure_backend \
  -v /tmp/postgres.json:/tmp/creds.json \
  -e N8N_USER_MANAGEMENT_DISABLED=false \
  -e N8N_ENCRYPTION_KEY="${N8N_ENCRYPTION_KEY}" \
  -e DB_TYPE=postgresdb \
  -e DB_POSTGRESDB_HOST=postgres \
  -e DB_POSTGRESDB_PORT=5432 \
  -e DB_POSTGRESDB_USER=n8n \
  -e DB_POSTGRESDB_PASSWORD="${N8N_PASSWORD}" \
  -e DB_POSTGRESDB_DATABASE=n8n \
  n8nio/n8n:1.85.0 \
  import:credentials --input=/tmp/creds.json --userId=58df1915-a5c6-43c6-b8fb-1c1fd878b874 2>&1 | tail -3

echo "--- import workflow ---"
docker run --rm --network infrastructure_backend \
  -v /tmp/n8n_workflow_with_rentals.json:/tmp/wf.json \
  -e N8N_USER_MANAGEMENT_DISABLED=false \
  -e N8N_ENCRYPTION_KEY="${N8N_ENCRYPTION_KEY}" \
  -e DB_TYPE=postgresdb \
  -e DB_POSTGRESDB_HOST=postgres \
  -e DB_POSTGRESDB_PORT=5432 \
  -e DB_POSTGRESDB_USER=n8n \
  -e DB_POSTGRESDB_PASSWORD="${N8N_PASSWORD}" \
  -e DB_POSTGRESDB_DATABASE=n8n \
  n8nio/n8n:1.85.0 \
  import:workflow --input=/tmp/wf.json --userId=58df1915-a5c6-43c6-b8fb-1c1fd878b874 2>&1 | tail -3

echo "--- start n8n ---"
./infrastructure/deploy.sh up -d n8n 2>&1 | tail -3
sleep 25
echo "--- check workflow count ---"
curl -s -X POST -H "Content-Type: application/json" http://127.0.0.1:5678/rest/login \
  -d "{\"emailOrLdapLoginId\":\"${N8N_USER_EMAIL}\",\"password\":\"${N8N_PASSWORD}\"}" \
  -c /tmp/cookies -o /dev/null
curl -s -b /tmp/cookies http://127.0.0.1:5678/rest/workflows | head -c 500
echo
