#!/bin/bash
# Wrapper for docker compose that sources .env first.
# Usage:  ./deploy.sh up -d
#         ./deploy.sh logs -f app
#         ./deploy.sh ps

set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "ERROR: .env not found in project root."
  echo "  Run: cp .env.example .env  &&  nano .env"
  exit 1
fi

set -a
. ./.env
set +a

docker compose -f infrastructure/docker-compose.yml "$@"
