#!/usr/bin/env bash
# Stop the locally-started HD-Search services (started by ./start_hd_search_all.sh).
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

# belt-and-suspenders: free the known HD-Search ports if still held (covers npm→next
# child processes that don't receive the signal sent to the npm parent)
for p in "${API_PORT:-8791}" "${WEB_PORT:-3030}" 3030 3020; do
  lsof -ti:"$p" 2>/dev/null | xargs kill 2>/dev/null || true
done

# stop ONLY the engines HD-Search owns (openserp/searxng). The shared
# hackerdogs-crawl4ai / hackerdogs-browserless are reused and left running.
if [ "${KEEP_PROVIDERS:-}" != "1" ] && command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo "→ stopping HD-Search engines (openserp/searxng); leaving shared crawl4ai/browserless up…"
  docker compose stop hd-openserp hd-searxng >/dev/null 2>&1 || true
fi
echo "✅ stopped"
