#!/usr/bin/env bash
# Stop the full Docker stack started by ./start_docker.sh.
#
#   ./stop_docker.sh           # docker compose down (keeps volumes)
#   ./stop_docker.sh --volumes # also remove named volumes (destructive)
set -euo pipefail
cd "$(dirname "$0")"

if [ "${1:-}" = "--volumes" ] || [ "${1:-}" = "-v" ]; then
  echo "→ tearing down Docker stack AND volumes"
  exec docker compose -f docker-compose-full.yml down -v
fi

echo "→ tearing down Docker stack (volumes kept)"
exec docker compose -f docker-compose-full.yml down
