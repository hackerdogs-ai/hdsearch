#!/usr/bin/env bash
# Run the HD-Search API locally against your already-running infra (hd-redis,
# hd-db, hd-seaweedfs, transformers-inference). Self-hosted providers (openserp,
# searxng, crawl4ai) are optional locally — the engine falls back to free public
# providers (DuckDuckGo, Wikipedia, GDELT, Common Crawl, Ahmia) when they're down.
#
#   ./start_hd_search.sh            # dev server (tsx watch)
#   ./start_hd_search.sh build      # compiled prod server
set -euo pipefail
cd "$(dirname "$0")/api"

if [ ! -f .env ]; then
  echo "→ creating api/.env from .env.example (fill in HDSEARCH_ENCRYPTION_KEY!)"
  cp .env.example .env
  # auto-generate an encryption key if openssl is available
  if command -v openssl >/dev/null 2>&1; then
    KEY=$(openssl rand -hex 32)
    # macOS/BSD sed compatible
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
  echo "→ starting dev server (tsx watch) on :${HDSEARCH_API_PORT:-8791}"
  exec npm run dev
fi
