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
#   --desc-only          Only update the Docker Hub description; build/push nothing.
#   --no-desc            Skip the Docker Hub description update.
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
PUSH=1; DO_API=1; DO_WEB=1; NO_CACHE=0; DRY=0; NATIVE=0; DO_DESC=1; DESC_ONLY=0
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
    --no-desc)    DO_DESC=0; shift ;;
    --desc-only)  DESC_ONLY=1; shift ;;
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

# ---- Docker Hub repository description -------------------------------------
# The Hub "About"/README is set through the Hub REST API, not by `docker push`,
# so pushing images alone leaves the repo page blank. The long description is
# generated from README.md at publish time so the two never drift.
#
# Needs a Docker Hub Personal Access Token with read/write on the repo:
#   export DOCKERHUB_USERNAME=<user>
#   export DOCKERHUB_TOKEN=<PAT>        # https://app.docker.com/settings/personal-access-tokens
# The token is read from the environment and never printed or stored.
SHORT_DESC="Self-hosted API for search, crawl, vector search and agentic AI across 20+ engines."

update_description() {
  local repo="$1"
  if [ -z "${DOCKERHUB_USERNAME:-}" ] || [ -z "${DOCKERHUB_TOKEN:-}" ]; then
    warn "skipping description for ${NS}/${repo} — set DOCKERHUB_USERNAME and DOCKERHUB_TOKEN to enable"
    return 0
  fi
  [ -f README.md ] || { warn "README.md not found; skipping description"; return 0; }

  info "updating Docker Hub description for ${NS}/${repo}"
  DH_USER="$DOCKERHUB_USERNAME" DH_TOKEN="$DOCKERHUB_TOKEN" \
  DH_NS="$NS" DH_REPO="$repo" DH_SHORT="$SHORT_DESC" python3 - <<'PYEOF'
import json, os, sys, urllib.request, urllib.error

user, token = os.environ["DH_USER"], os.environ["DH_TOKEN"]
ns, repo     = os.environ["DH_NS"], os.environ["DH_REPO"]

def post(url, payload, headers):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"content-type": "application/json", **headers})
    return json.load(urllib.request.urlopen(req, timeout=30))

def patch(url, payload, headers):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"content-type": "application/json", **headers}, method="PATCH")
    return json.load(urllib.request.urlopen(req, timeout=30))

readme = open("README.md", encoding="utf-8").read()
# Point Hub readers back at the canonical source before the README body.
header = (
    f"> **Source, issues and full documentation: "
    f"https://github.com/hackerdogs-ai/hdsearch**\n>\n"
    f"> Images: `{ns}/hdsearch:api` (REST API + MCP server) and `{ns}/hdsearch:web` (Next.js UI). "
    f"Run them together with the compose files in the repo.\n\n---\n\n"
)
LIMIT = 25000                              # Hub caps full_description
tail = "\n\n---\n\nFull README, development guide and roadmap: https://github.com/hackerdogs-ai/hdsearch\n"

def drop_section(md, heading):
    """Remove one '## ...' section (up to the next '## ' or EOF)."""
    i = md.find(heading)
    if i < 0:
        return md
    j = md.find("\n## ", i + len(heading))
    return md[:i] + (md[j + 1:] if j > 0 else "")

# Sections a Docker Hub reader does not need — dropped first, in this order, so
# the parts that matter to someone pulling the image (quickstart, providers,
# credits) survive rather than being blind-truncated off the end.
HUB_OMIT = ["## 🛠️ Development", "## 🐳 Publish your own images",
            "## 🗺️ Roadmap", "## 🤝 Contributing"]

body = readme
for h in HUB_OMIT:
    if len(header) + len(body) + len(tail) <= LIMIT:
        break
    body = drop_section(body, h)

full = header + body
if len(full) + len(tail) > LIMIT:          # still too long → cut on a heading
    cut_at = full[: LIMIT - len(tail)]
    k = cut_at.rfind("\n## ")
    full = cut_at[:k] if k > 0 else cut_at.rsplit("\n", 1)[0]
full = full.rstrip() + tail

try:
    jwt = post("https://hub.docker.com/v2/users/login/", {"username": user, "password": token}, {})["token"]
except urllib.error.HTTPError as e:
    print(f"  login failed: HTTP {e.code} — check DOCKERHUB_USERNAME / DOCKERHUB_TOKEN", file=sys.stderr)
    sys.exit(1)

try:
    patch(f"https://hub.docker.com/v2/repositories/{ns}/{repo}/",
          {"description": os.environ["DH_SHORT"], "full_description": full},
          {"authorization": f"JWT {jwt}"})
    print(f"  description updated ({len(full)} chars)")
except urllib.error.HTTPError as e:
    print(f"  update failed: HTTP {e.code} {e.read()[:200]!r}", file=sys.stderr)
    sys.exit(1)
PYEOF
}

if [ "$DESC_ONLY" = 1 ]; then
  update_description hdsearch
  ok "Done (description only)."
  exit 0
fi

[ "$DO_API" = 1 ] && build_image api ./api ./api/Dockerfile
[ "$DO_WEB" = 1 ] && build_image web ./web ./web/Dockerfile

if [ "$PUSH" = 1 ] && [ "$DO_DESC" = 1 ]; then update_description hdsearch; fi

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
