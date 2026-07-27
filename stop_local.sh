#!/usr/bin/env bash
# Stop locally-started API/web processes (./start_api.sh / ./start_web.sh) that
# left PIDs under .run/. Does not touch the Docker stack — use ./stop_docker.sh.
set -euo pipefail
cd "$(dirname "$0")"
RUN_DIR=".run"

stop_one() {
  local name="$1" pidfile="$RUN_DIR/$1.pid"
  if [ -f "$pidfile" ]; then
    local pid; pid="$(cat "$pidfile")"
    if kill "$pid" 2>/dev/null; then echo "→ stopped $name (pid $pid)"; else echo "→ $name not running (pid $pid)"; fi
    rm -f "$pidfile"
  else
    echo "→ no pid file for $name"
  fi
}

stop_one api
stop_one web

# Free known local ports if still held (covers npm→next child processes).
for p in "${API_PORT:-8791}" "${WEB_PORT:-3030}" 3030 3020 3005; do
  lsof -ti:"$p" 2>/dev/null | xargs kill 2>/dev/null || true
done

echo "✅ local api/web stopped (Docker stack untouched — ./stop_docker.sh to tear that down)"
