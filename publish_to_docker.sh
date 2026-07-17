#!/usr/bin/env bash
#
# publish_to_docker.sh — build & publish the HD-Search images to Docker Hub.
#
# Publishes two component images under one repo:
#   <namespace>/hdsearch:api   (built from ./api)   — the aggregator API (Hono)
#   <namespace>/hdsearch:web   (built from ./web)   — the Next.js web UI
# and, when a version is given, also :api-<version> / :web-<version>.
#
# Multi-arch (linux/amd64 + linux/arm64) via `docker buildx` by default.
#
# ─────────────────────────────────────────────────────────────────────────────
# USAGE
#   ./publish_to_docker.sh [OPTIONS] <namespace> [version] [extra-tag...]
#
# EXAMPLES
#   ./publish_to_docker.sh hackerdogs                 # build+push :api :web (latest)
#   ./publish_to_docker.sh hackerdogs v1.0.0          # + :api-v1.0.0 :web-v1.0.0
#   ./publish_to_docker.sh --build-only hackerdogs    # build locally, don't push
#   ./publish_to_docker.sh --native hackerdogs        # fast: this host's arch only
#   ./publish_to_docker.sh --api-only hackerdogs      # only the API image
#   ./publish_to_docker.sh --dry-run hackerdogs v1.0.0
#
# OPTIONS
#   --build-only         Build (load locally); do NOT push to Docker Hub.
#   --native             Build only this host's architecture (fast; single-arch).
#   --platforms <list>   Override platforms (default: linux/amd64,linux/arm64).
#   --api-only           Only build/push the API image.
#   --web-only           Only build/push the Web image.
#   --no-cache           Build without using the layer cache.
#   --dry-run            Print what would run, then exit (no build/push).
#   -h, --help           Show this help and exit.
#
# NOTES
#   • Pushing requires `docker login` first (to an account with push access to the
#     <namespace>). The script fails fast if you are not authenticated.
#   • The first push CREATES the repo; check its visibility (public/private) in
#     Docker Hub settings so users can `docker pull` it.
#   • To run the published images, see docker-compose.hub.yml (pull + run, no build).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"

RED=$'\033[0;31m'; GRN=$'\033[0;32m'; YEL=$'\033[1;33m'; CYN=$'\033[0;36m'; NC=$'\033[0m'
info(){ echo "${CYN}→${NC} $*"; }
ok(){   echo "${GRN}✓${NC} $*"; }
warn(){ echo "${YEL}!${NC} $*"; }
die(){  echo "${RED}✗ $*${NC}" >&2; exit 1; }
usage(){ sed -n '2,45p' "$0" | sed 's/^# \{0,1\}//'; }

PLATFORMS="linux/amd64,linux/arm64"
PUSH=1; DO_API=1; DO_WEB=1; NO_CACHE=0; DRY=0; NATIVE=0
ARGS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --build-only) PUSH=0; shift ;;
    --native)     NATIVE=1; shift ;;
    --platforms)  PLATFORMS="${2:?--platforms needs a value}"; shift 2 ;;
    --api-only)   DO_WEB=0; shift ;;
    --web-only)   DO_API=0; shift ;;
    --no-cache)   NO_CACHE=1; shift ;;
    --dry-run)    DRY=1; shift ;;
    -h|--help)    usage; exit 0 ;;
    --*)          die "unknown option: $1 (try --help)" ;;
    *)            ARGS+=("$1"); shift ;;
  esac
done

NS="${ARGS[0]:-}"
[ -n "$NS" ] || { usage; echo; die "<namespace> (Docker Hub user/org) is required"; }
TAGS=("${ARGS[@]:1}"); [ ${#TAGS[@]} -eq 0 ] && TAGS=("latest")
[ "$NATIVE" = 1 ] && PLATFORMS="$(uname -m | grep -qi 'arm\|aarch' && echo linux/arm64 || echo linux/amd64)"

# ---- preflight ----
command -v docker >/dev/null || die "docker not found"
docker buildx version >/dev/null 2>&1 || die "docker buildx required (Docker 19.03+)"
[ "$DO_API" = 1 ] && { [ -f ./api/Dockerfile ] || die "./api/Dockerfile not found"; }
[ "$DO_WEB" = 1 ] && { [ -f ./web/Dockerfile ] || die "./web/Dockerfile not found"; }

echo "${GRN}HD-Search → Docker Hub${NC}"
echo "  namespace : $NS"
echo "  images    : $([ $DO_API = 1 ] && echo -n 'hdsearch:api ')$([ $DO_WEB = 1 ] && echo -n 'hdsearch:web')"
echo "  tags      : ${TAGS[*]}"
echo "  platforms : $PLATFORMS"
echo "  action    : $([ $PUSH = 1 ] && echo 'build + PUSH' || echo 'build locally (no push)')"
echo ""

if [ "$DRY" = 1 ]; then warn "dry-run: nothing built or pushed."; exit 0; fi

if [ "$PUSH" = 1 ]; then
  info "checking Docker Hub authentication…"
  docker login </dev/null 2>&1 | grep -qi "Login Succeeded" \
    || die "not authenticated. Run:  docker login -u $NS   (need push access to '$NS')"
  ok "authenticated to Docker Hub"
fi

BUILDER="hdsearch-builder"
docker buildx inspect "$BUILDER" >/dev/null 2>&1 \
  && docker buildx use "$BUILDER" >/dev/null \
  || { info "creating buildx builder '$BUILDER'"; docker buildx create --name "$BUILDER" --use --bootstrap >/dev/null; }

build_image() {
  local component="$1" context="$2" dockerfile="$3"
  local args=(buildx build --platform "$PLATFORMS" --provenance=false --sbom=false -f "$dockerfile")
  [ "$NO_CACHE" = 1 ] && args+=(--no-cache)
  args+=(-t "${NS}/hdsearch:${component}")
  for t in "${TAGS[@]}"; do [ "$t" = "latest" ] || args+=(-t "${NS}/hdsearch:${component}-${t}"); done
  if [ "$PUSH" = 1 ]; then args+=(--push); else
    case "$PLATFORMS" in *,*) : ;; *) args+=(--load) ;; esac   # --load only for single-arch
  fi
  echo ""; echo "${GRN}=== hdsearch:${component} ===${NC}  context=$context"
  docker "${args[@]}" "$context"
  ok "$([ $PUSH = 1 ] && echo pushed || echo built) ${NS}/hdsearch:${component}"
}

[ "$DO_API" = 1 ] && build_image api ./api ./api/Dockerfile
[ "$DO_WEB" = 1 ] && build_image web ./web ./web/Dockerfile

echo ""; ok "Done."
if [ "$PUSH" = 1 ]; then
  echo ""
  echo "Run the published stack (no build needed):"
  echo "  ${CYN}HDSEARCH_IMAGE_NS=$NS docker compose -f docker-compose-full.yml up -d${NC}"
  echo "  open http://localhost:3000"
  echo ""
  echo "Or pull directly:"
  [ "$DO_API" = 1 ] && echo "  docker pull ${NS}/hdsearch:api"
  [ "$DO_WEB" = 1 ] && echo "  docker pull ${NS}/hdsearch:web"
fi
