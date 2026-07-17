#!/usr/bin/env bash
# Start BOTH HD-Search services locally (API + web UI) in the background, wired to
# your existing infra (hd-redis, hd-db, hd-seaweedfs, transformers-inference).
# Generates a shared internal secret so the web BFF can call the API as the
# logged-in user. PIDs + logs live under .run/. Stop with ./stop_hd_search.sh
#
#   ./start_hd_search_all.sh                 # API :8791, Web :3030 (dev, hot reload)
#   WEB_PORT=3030 ./start_hd_search_all.sh   # Web on :3030 instead
#   API_PORT=8801 WEB_PORT=3030 ./start_hd_search_all.sh
#   ./start_hd_search_all.sh prod            # compiled production build
#   ./start_hd_search_all.sh --foreground    # run attached (stream logs, Ctrl-C stops both)
#   ./start_hd_search_all.sh --with-maps     # also self-host the OSM geocoder (Photon)
#                                            # REGION via HDSEARCH_PHOTON_REGION (default monaco)
set -euo pipefail
cd "$(dirname "$0")"

usage() {
  cat <<'EOF'
Usage: ./start_hd_search_all.sh [MODE] [OPTIONS]

Start both HD-Search services (API + Web) locally.

Modes (positional, default: dev):
  dev         tsx watch (API) + next dev (Web) — hot reload (default)
  prod        compiled build then start

Options:
  -f, --foreground   Run attached — stream logs, Ctrl-C stops both
  --with-maps        Self-host the OSM geocoder (Photon :2322)
  -h, --help         Show this help

Environment overrides:
  API_PORT            API listen port            (default 8791)
  WEB_PORT            Web listen port            (default 3030)
  SKIP_PROVIDERS=1    Skip Docker search engines
  PG_SUPER_PASSWORD   Run db/setup.sh for roles + schema

Examples:
  ./start_hd_search_all.sh                        # dev (hot reload)
  ./start_hd_search_all.sh prod -f                # prod, foreground logs
  WEB_PORT=3030 ./start_hd_search_all.sh prod     # prod on custom port
  ./start_hd_search_all.sh --with-maps            # + local Photon geocoder

Stop:  ./stop_hd_search.sh
Logs:  .run/api.log, .run/web.log
EOF
  exit 0
}

API_PORT="${API_PORT:-8791}"
WEB_PORT="${WEB_PORT:-3030}"
RUN_DIR=".run"
mkdir -p "$RUN_DIR"

# parse args: a positional MODE (dev|prod|build) + optional --foreground/--f + --with-maps
# Default to dev (hot reload, like WM's startwm.sh); pass "prod" or "build" for compiled.
MODE="dev"
FOREGROUND=0
WITH_MAPS=0
for a in "$@"; do
  case "$a" in
    -h|--help) usage ;;
    --foreground|--f|-f) FOREGROUND=1 ;;
    --with-maps|--maps) WITH_MAPS=1 ;;
    dev|prod|build) MODE="$a" ;;
    *) ;;
  esac
done

gen() { command -v openssl >/dev/null 2>&1 && openssl rand -hex 32 || echo "change-me-$(date +%s)$RANDOM"; }

wait_http() {
  local url="$1" label="$2" timeout="${3:-30}"
  bash "$(dirname "$0")/scripts/wait-for-url.sh" "$url" 200 "$timeout" "$label"
}

verify_prod_artifacts() {
  local ok=1
  if [ ! -f api/dist/src/index.js ]; then
    echo "❌ missing api/dist/src/index.js — API build failed or not run"
    ok=0
  fi
  if [ ! -f api/dist/src/ai/llm-providers.json ]; then
    echo "❌ missing api/dist/src/ai/llm-providers.json — run: (cd api && npm run build)"
    ok=0
  fi
  if [ ! -f web/.next/standalone/server.js ]; then
    echo "❌ missing web/.next/standalone/server.js — run: (cd web && npm run build)"
    ok=0
  fi
  if [ ! -d web/.next/standalone/.next/static ]; then
    echo "❌ missing web/.next/standalone/.next/static — run: (cd web && npm run build)"
    ok=0
  fi
  [ "$ok" = 1 ] || exit 1
}

show_log_tail() {
  local file="$1" label="$2"
  if [ -s "$file" ]; then
    echo ""
    echo "── ${label} (last 25 lines) ──"
    tail -25 "$file"
  fi
}

# ── provision api/.env ───────────────────────────────────────────────────────
if [ ! -f api/.env ]; then
  cp api/.env.example api/.env
  sed -i.bak "s|^HDSEARCH_ENCRYPTION_KEY=.*|HDSEARCH_ENCRYPTION_KEY=$(gen)|" api/.env && rm -f api/.env.bak
  sed -i.bak "s|^HDSEARCH_INTERNAL_SECRET=.*|HDSEARCH_INTERNAL_SECRET=$(gen)|" api/.env && rm -f api/.env.bak
  echo "→ created api/.env (encryption + internal secret generated)"
fi
SECRET="$(grep -E '^HDSEARCH_INTERNAL_SECRET=' api/.env | head -1 | cut -d= -f2-)"
if [ -z "$SECRET" ]; then
  SECRET="$(gen)"
  sed -i.bak "s|^HDSEARCH_INTERNAL_SECRET=.*|HDSEARCH_INTERNAL_SECRET=${SECRET}|" api/.env && rm -f api/.env.bak
fi

# ── provision web/.env.local ─────────────────────────────────────────────────
APP_BASE_URL="http://localhost:${WEB_PORT}"
[ -f web/.env.local ] || cp web/.env.example web/.env.local
set_kv() { sed -i.bak "s|^$1=.*|$1=$2|" web/.env.local && rm -f web/.env.local.bak; }
set_kv HDSEARCH_API_URL "http://127.0.0.1:${API_PORT}"
set_kv NEXT_PUBLIC_API_URL "http://localhost:${API_PORT}"
set_kv HDSEARCH_INTERNAL_SECRET "${SECRET}"
set_kv APP_BASE_URL "${APP_BASE_URL}"
grep -qE '^HDSEARCH_WEB_SESSION_SECRET=.+' web/.env.local || set_kv HDSEARCH_WEB_SESSION_SECRET "$(gen)"

# ── deps ─────────────────────────────────────────────────────────────────────
[ -d api/node_modules ] || ( echo "→ installing api deps"; cd api && npm install )
[ -d web/node_modules ] || ( echo "→ installing web deps"; cd web && npm install )

# Production build output breaks `next dev` chunk URLs (ChunkLoadError on /search, etc.).
# Markers: standalone output, export-marker, or hashed page chunks without dev page.js.
if [ "$MODE" = "dev" ] && {
  [ "${CLEAN_NEXT:-}" = "1" ] ||
  [ -d web/.next/standalone ] ||
  [ -f web/.next/export-marker.json ] ||
  { [ -d web/.next/static/chunks/app/search ] && [ ! -f web/.next/static/chunks/app/search/page.js ]; }
}; then
  echo "→ clearing web/.next (stale production build — required for dev server)"
  rm -rf web/.next
fi

# ── self-hosted provider services (free, highest priority) ───────────────────
# Brings up openserp/searxng/crawl4ai as containers on hdnet, published on the
# host ports the API's defaults point at (7000 / 8888 / 11235). Skipped cleanly
# if Docker isn't available — the engine then falls back to public providers.
if [ "${SKIP_PROVIDERS:-}" != "1" ] && command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker network inspect hdnet >/dev/null 2>&1 || docker network create hdnet >/dev/null
  # crawl4ai + browserless are REUSED from the existing shared containers
  # (hackerdogs-crawl4ai :11235, hackerdogs-browserless :3000) — we only bring up
  # the search engines openserp (:7007) + searxng (:8899).
  echo "→ starting search engines (openserp :7007, searxng :8899); Redis = shared hd-redis :6379 db 2…"
  if ! docker inspect -f '{{.State.Health.Status}}' hd-redis 2>/dev/null | grep -qE 'healthy|starting'; then
    echo "⚠️  hd-redis not running — from repo root run: ./start_core_infra.sh up"
  fi
  if docker compose up -d hd-openserp hd-searxng >"$RUN_DIR/providers.log" 2>&1; then
    echo "   openserp + searxng requested (first run pulls images — see $RUN_DIR/providers.log)"
  else
    echo "⚠️  could not start openserp/searxng — search falls back to public providers. See $RUN_DIR/providers.log"
  fi
  docker ps --filter name=hackerdogs-crawl4ai --filter name=hackerdogs-browserless --format '   reusing {{.Names}} ({{.Status}})'

  # ── self-hosted OSM geocoder (Photon) for the Maps tab — opt-in (--with-maps) ──
  # Maps work without this (the API falls back to the public Photon instance). With
  # the flag we bring up a local Photon container and point the API at it. First run
  # downloads the OSM index for HDSEARCH_PHOTON_REGION (default `monaco`, a few MB;
  # set to your country/continent or `planet` ~116GB for full coverage).
  if [ "$WITH_MAPS" = 1 ]; then
    REGION="${HDSEARCH_PHOTON_REGION:-monaco}"
    echo "→ starting self-hosted Photon geocoder (hd-photon :2322, REGION=$REGION; first run downloads the OSM index)…"
    if HDSEARCH_PHOTON_REGION="$REGION" docker compose --profile maps up -d hd-photon >>"$RUN_DIR/providers.log" 2>&1; then
      # point the LOCAL API at the container; code default is public Photon
      set_env_api() { grep -qE "^$1=" api/.env && sed -i.bak "s|^$1=.*|$1=$2|" api/.env && rm -f api/.env.bak || echo "$1=$2" >> api/.env; }
      set_env_api HDSEARCH_GEOCODER_ENGINE photon
      set_env_api HDSEARCH_GEOCODER_URL "http://127.0.0.1:2322"
      echo "   hd-photon requested — Maps will use it once the index finishes loading (curl localhost:2322/api?q=test)"
    else
      echo "⚠️  could not start hd-photon — Maps fall back to the public Photon. See $RUN_DIR/providers.log"
    fi
  fi
else
  echo "→ skipping self-hosted engines (SKIP_PROVIDERS=1 or Docker unavailable); using public providers"
fi

# ── database roles + schema (optional, needs the superuser password) ─────────
# If PG_SUPER_PASSWORD is provided, ensure roles/schema/grants exist (db/setup.sh).
if [ -n "${PG_SUPER_PASSWORD:-}" ]; then
  echo "→ ensuring database roles + schema (db/setup.sh)"
  PG_SUPER_PASSWORD="$PG_SUPER_PASSWORD" bash api/db/setup.sh >"$RUN_DIR/db-setup.log" 2>&1 \
    && echo "   db ready (roles: hdsearchadmin/hdsearchrw/hdsearchreadonly)" \
    || echo "⚠️  db setup failed — see $RUN_DIR/db-setup.log"
fi

# ── build SYNCHRONOUSLY (prod mode) so failures are visible and start is clean ─
if [ "$MODE" != "dev" ]; then
  echo "→ building API…"
  ( cd api && npm run build ) || { echo "❌ API build failed"; exit 1; }
  echo "→ building Web (Next.js standalone, ~30–60s)…"
  ( cd web && npm run build ) || { echo "❌ Web build failed"; exit 1; }
  verify_prod_artifacts
fi

# ── migrate (best-effort) ────────────────────────────────────────────────────
( cd api && npm run migrate >/dev/null 2>&1 && echo "→ db schema applied" || echo "⚠️  db migrate skipped (Postgres reachable? hd_search db exists?)" )

# ── kill stale processes on our ports (avoids EADDRINUSE on restart) ─────────
for _p in "$API_PORT" "$WEB_PORT"; do
  lsof -ti :"$_p" 2>/dev/null | xargs kill -9 2>/dev/null || true
done
sleep 0.5

# Fresh logs — avoid replaying hundreds of stale "Ready" lines from old broken starts
: >"$RUN_DIR/api.log"
: >"$RUN_DIR/web.log"

# ── start API (background) ───────────────────────────────────────────────────
# NOTE: the `cd` runs inside the backgrounded subshell only; the redirect + the
# `echo $!` run in the main shell (cwd = service root), so $RUN_DIR paths are
# resolved here, not inside api/.
echo "→ starting API on :${API_PORT}"
if [ "$MODE" = "dev" ]; then
  ( cd api && HDSEARCH_API_PORT="$API_PORT" exec npm run dev ) >"$RUN_DIR/api.log" 2>&1 &
else
  ( cd api && HDSEARCH_API_PORT="$API_PORT" exec node dist/src/index.js ) >"$RUN_DIR/api.log" 2>&1 &
fi
echo $! >"$RUN_DIR/api.pid"

# ── start Web (background) ───────────────────────────────────────────────────
echo "→ starting Web on :${WEB_PORT}"
if [ "$MODE" = "dev" ]; then
  ( cd web && PORT="$WEB_PORT" exec npm run dev ) >"$RUN_DIR/web.log" 2>&1 &
else
  # output: standalone — same entrypoint as web/Dockerfile (node server.js), not next start
  ( cd web && PORT="$WEB_PORT" NODE_ENV=production exec node .next/standalone/server.js ) >"$RUN_DIR/web.log" 2>&1 &
fi
echo $! >"$RUN_DIR/web.pid"

# ── wait for health ──────────────────────────────────────────────────────────
echo "→ waiting for API (:${API_PORT}/health) and Web (:${WEB_PORT})…"
api_ok=000
web_ok=000
if wait_http "http://localhost:${API_PORT}/health" "API" 30; then api_ok=200; fi
if wait_http "http://localhost:${WEB_PORT}/" "Web" 30; then web_ok=200; fi
if [ "$api_ok" != "200" ] || [ "$web_ok" != "200" ]; then
  show_log_tail "$RUN_DIR/api.log" "api.log"
  show_log_tail "$RUN_DIR/web.log" "web.log"
fi

echo ""
echo "  API  http://localhost:${API_PORT}/healthz   [$api_ok]"
echo "  Web  ${APP_BASE_URL}                         [$web_ok]"
if [ "$api_ok" = "200" ] && [ "$web_ok" = "200" ]; then
  echo "✅ HD-Search is up. Open ${APP_BASE_URL} (Sign in → dev login works with no Auth0)."
else
  echo "⚠️  Something didn't come up. Check ${RUN_DIR}/api.log and ${RUN_DIR}/web.log"
fi

if [ "$FOREGROUND" = 1 ]; then
  API_PID="$(cat "$RUN_DIR/api.pid" 2>/dev/null)"
  WEB_PID="$(cat "$RUN_DIR/web.pid" 2>/dev/null)"
  echo "   Running in FOREGROUND — new log lines only. Press Ctrl-C to stop both."
  # stop both children on Ctrl-C / TERM
  trap 'echo; echo "→ stopping…"; kill '"$API_PID $WEB_PID"' 2>/dev/null; rm -f "'"$RUN_DIR"'/api.pid" "'"$RUN_DIR"'/web.pid"; exit 0' INT TERM
  # -n 0 = do not replay old log lines (avoids stale Ready spam from prior runs)
  tail -n 0 -f "$RUN_DIR/api.log" "$RUN_DIR/web.log" &
  TAIL_PID=$!
  wait "$API_PID" "$WEB_PID" 2>/dev/null || true
  kill "$TAIL_PID" 2>/dev/null || true
else
  echo "   Stop: ./stop_hd_search.sh   (or re-run with --foreground to run attached)"
fi
