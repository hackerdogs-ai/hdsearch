#!/usr/bin/env bash
# Start the full self-contained hdsearch stack in Docker (hds-* on hdsearchnet).
#
#   ./start_docker.sh              # up (pull/build as needed)
#   ./start_docker.sh up --build   # force rebuild
#   ./start_docker.sh down         # tear down containers (keeps volumes)
#   ./start_docker.sh stop         # stop without removing
#   ./start_docker.sh logs         # follow api + web logs
#
# Equivalent to: docker compose -f docker-compose-full.yml …
# Web port comes from root .env (WEB_PORT, default 3000).
set -euo pipefail
cd "$(dirname "$0")"

COMPOSE=(docker compose -f docker-compose-full.yml)

usage() {
  cat <<'EOF'
Usage: ./start_docker.sh [up|down|stop|logs|ps] [extra compose args…]

  up (default)  Start the full stack (infra + api + web)
  down          Stop and remove containers (volumes kept)
  stop          Stop containers without removing them
  logs          Follow hds-api + hds-web logs
  ps            Show stack status

Env (root .env): WEB_PORT, APP_BASE_URL, SMTP_*, …
EOF
  exit 0
}

cmd="${1:-up}"
case "$cmd" in
  -h|--help) usage ;;
  up)
    shift || true
    echo "→ starting full hdsearch Docker stack (docker-compose-full.yml)"
    "${COMPOSE[@]}" up -d "$@"
    web_port="$(grep -E '^WEB_PORT=' .env 2>/dev/null | head -1 | cut -d= -f2- || true)"
    web_port="${web_port:-3000}"
    echo ""
    echo "✅ stack up"
    echo "   Web  http://localhost:${web_port}"
    echo "   API  http://localhost:8791/health"
    echo "   Stop: ./stop_docker.sh   (or ./start_docker.sh down)"
    ;;
  down|stop|logs|ps)
    shift || true
    if [ "$cmd" = "logs" ] && [ "$#" -eq 0 ]; then
      exec "${COMPOSE[@]}" logs -f hds-api hds-web
    fi
    exec "${COMPOSE[@]}" "$cmd" "$@"
    ;;
  *)
    echo "Unknown command: $cmd (try --help)" >&2
    exit 1
    ;;
esac
