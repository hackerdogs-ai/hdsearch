#!/usr/bin/env bash
# Bring up the FULL HD-Search engine in one go (spec: "docker compose that runs
# the whole engine in one go"): API + web UI + openserp + searxng + crawl4ai,
# wired to your existing hdnet infra. Creates the hdnet network if missing.
#
# Images: hdsearch:api, hdsearch:web (see docker-compose.yml)
#
#   ./start_hd_search_stack.sh             # up + build + migrate
#   ./start_hd_search_stack.sh down        # tear down
#   (shared hd-redis Redis Stack on :6379 db 2 — start core infra first)
set -euo pipefail
cd "$(dirname "$0")"

gen() { command -v openssl >/dev/null 2>&1 && openssl rand -hex 32 || echo "change-me-$(date +%s)"; }

wait_http() {
  bash "$(dirname "$0")/scripts/wait-for-url.sh" "$1" 200 "${3:-45}" "$2" || return 1
}

if ! docker network inspect hdnet >/dev/null 2>&1; then
  echo "→ creating docker network hdnet"
  docker network create hdnet
fi

INTERNAL_SECRET="${HDSEARCH_INTERNAL_SECRET:-$(gen)}"
export HDSEARCH_INTERNAL_SECRET="$INTERNAL_SECRET"
export HDSEARCH_WEB_SESSION_SECRET="${HDSEARCH_WEB_SESSION_SECRET:-$(gen)}"

if [ ! -f api/.env ]; then
  cp api/.env.example api/.env
  ENC=$(gen)
  sed -i.bak "s|^HDSEARCH_ENCRYPTION_KEY=.*|HDSEARCH_ENCRYPTION_KEY=${ENC}|" api/.env && rm -f api/.env.bak
  sed -i.bak "s|^HDSEARCH_INTERNAL_SECRET=.*|HDSEARCH_INTERNAL_SECRET=${INTERNAL_SECRET}|" api/.env && rm -f api/.env.bak
  echo "→ created api/.env (encryption + internal secret generated)"
fi

if [ ! -f web/.env ]; then
  cp web/.env.example web/.env
  sed -i.bak "s|^HDSEARCH_INTERNAL_SECRET=.*|HDSEARCH_INTERNAL_SECRET=${INTERNAL_SECRET}|" web/.env && rm -f web/.env.bak
  sed -i.bak "s|^HDSEARCH_WEB_SESSION_SECRET=.*|HDSEARCH_WEB_SESSION_SECRET=${HDSEARCH_WEB_SESSION_SECRET}|" web/.env && rm -f web/.env.bak
  echo "→ created web/.env (shares the API internal secret)"
fi

case "${1:-up}" in
  down)
    docker compose down
    ;;
  *)
    echo "→ building images hdsearch:api + hdsearch:web and starting stack"
    if ! docker inspect -f '{{.State.Health.Status}}' hd-redis 2>/dev/null | grep -qE 'healthy|starting'; then
      echo "⚠️  hd-redis not running — from repo root run: ./start_core_infra.sh up"
    fi
    docker compose up -d --build

    echo "→ waiting for services"
    api_up=0 web_up=0
    wait_http "http://localhost:8791/health" "hdsearch:api" 60 && api_up=1 || true
    wait_http "http://localhost:3000/" "hdsearch:web" 60 && web_up=1 || true

    if [ "$api_up" = 0 ]; then
      echo "── docker logs hdsearch (last 30 lines) ──"
      docker logs --tail 30 hdsearch 2>&1 || true
    fi
    if [ "$web_up" = 0 ]; then
      echo "── docker logs hdsearch-web (last 30 lines) ──"
      docker logs --tail 30 hdsearch-web 2>&1 || true
    fi

    if [ "$api_up" = 1 ] && [ "$web_up" = 1 ]; then
      echo "→ applying schema"
      docker compose run --rm hdsearch node dist/scripts/migrate.js || \
        echo "⚠️  migrate failed — ensure hd-db is reachable on hdnet and the hd_search database exists"
      echo ""
      echo "✅ hdsearch up (images: hdsearch:api, hdsearch:web)"
      echo "   Web  http://localhost:3000"
      echo "   API  http://localhost:8791/health"
      echo "   issue an API key: docker compose run --rm hdsearch node dist/scripts/hds-keys.js issue --user dev --name local"
    else
      echo "❌ hdsearch did not become healthy — fix errors above, then: docker compose up -d --build"
      exit 1
    fi
    ;;
esac
