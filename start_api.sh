#!/usr/bin/env bash
# Start the hdsearch API locally (tsx watch / prod build).
# Expects datastores reachable per api/.env (or point at the Docker infra).
#
#   ./start_api.sh            # dev server (tsx watch) on :8791
#   ./start_api.sh build      # compiled production server
#
# For the full containerized stack, use ./start_docker.sh instead.
set -euo pipefail
cd "$(dirname "$0")/api"

if [ ! -f .env ]; then
  echo "→ creating api/.env from .env.example (fill in HDSEARCH_ENCRYPTION_KEY!)"
  cp .env.example .env
  if command -v openssl >/dev/null 2>&1; then
    KEY=$(openssl rand -hex 32)
    sed -i.bak "s|^HDSEARCH_ENCRYPTION_KEY=.*|HDSEARCH_ENCRYPTION_KEY=${KEY}|" .env && rm -f .env.bak
    echo "→ generated HDSEARCH_ENCRYPTION_KEY"
  fi
fi

if [ ! -d node_modules ]; then
  echo "→ installing dependencies"
  npm install
fi

echo "→ applying database schema (idempotent)"
npm run migrate || echo "⚠️  migrate failed (Postgres reachable? schema/db created?) — continuing"

if [ "${1:-dev}" = "build" ]; then
  echo "→ building + starting (production mode)"
  npm run build
  exec npm start
else
  echo "→ starting API dev server (tsx watch) on :${HDSEARCH_API_PORT:-8791}"
  exec npm run dev
fi
