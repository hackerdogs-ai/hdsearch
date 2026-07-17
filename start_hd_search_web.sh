#!/usr/bin/env bash
# Run the HD-Search web UI locally (Next.js dev server). Expects the API running
# on :8791 (use ./start_hd_search.sh in another shell). Auth0 is optional — without
# it you get a local dev login.
#
#   ./start_hd_search_web.sh            # dev server on :3000
#   ./start_hd_search_web.sh 3010       # dev server on :3010
#   PORT=3010 ./start_hd_search_web.sh  # same via env
#   ./start_hd_search_web.sh 3010 build # compiled prod server on :3010
set -euo pipefail
cd "$(dirname "$0")/web"

PORT="${1:-${PORT:-3000}}"
MODE="${2:-dev}"
# APP_BASE_URL MUST match the port — login/redirect URLs are derived from it.
export PORT
export APP_BASE_URL="${APP_BASE_URL:-http://localhost:${PORT}}"

gen() { command -v openssl >/dev/null 2>&1 && openssl rand -hex 32 || echo "dev-secret"; }

if [ ! -f .env.local ]; then
  cp .env.example .env.local
  sed -i.bak "s|^HDSEARCH_WEB_SESSION_SECRET=.*|HDSEARCH_WEB_SESSION_SECRET=$(gen)|" .env.local && rm -f .env.local.bak
  sed -i.bak "s|^APP_BASE_URL=.*|APP_BASE_URL=${APP_BASE_URL}|" .env.local && rm -f .env.local.bak
  # match the API's internal secret if it exists
  if [ -f ../api/.env ]; then
    SECRET=$(grep -E '^HDSEARCH_INTERNAL_SECRET=' ../api/.env | head -1 | cut -d= -f2-)
    [ -n "$SECRET" ] && sed -i.bak "s|^HDSEARCH_INTERNAL_SECRET=.*|HDSEARCH_INTERNAL_SECRET=${SECRET}|" .env.local && rm -f .env.local.bak
  fi
  echo "→ created web/.env.local (APP_BASE_URL=${APP_BASE_URL}; set HDSEARCH_INTERNAL_SECRET to match the API)"
fi

[ -d node_modules ] || { echo "→ installing deps"; npm install; }

# Production build output breaks `next dev` chunk URLs (ChunkLoadError on /search, etc.).
if [ "$MODE" = "dev" ] && {
  [ "${CLEAN_NEXT:-}" = "1" ] ||
  [ -d .next/standalone ] ||
  [ -f .next/export-marker.json ] ||
  { [ -d .next/static/chunks/app/search ] && [ ! -f .next/static/chunks/app/search/page.js ]; }
}; then
  echo "→ clearing .next (stale production build — required for dev server)"
  rm -rf .next
fi

if [ "$MODE" = "build" ]; then
  echo "→ building + starting (standalone production) on http://localhost:${PORT}"
  npm run build
  export NODE_ENV=production
  exec node .next/standalone/server.js
else
  echo "→ starting Next.js dev server on http://localhost:${PORT}"
  exec npm run dev
fi
