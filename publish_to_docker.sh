#!/usr/bin/env bash
# Build and publish the hdsearch Docker images (API + Web) to Docker Hub.
# Multi-arch (linux/amd64 + linux/arm64) via buildx.
#
# Images (one repo name, component tags):
#   <user>/hdsearch:api   (built from ./api)
#   <user>/hdsearch:web   (built from ./web)
#   <user>/hdsearch:api-<version>  when publishing a version tag
#
# Usage:
#   ./publish_to_docker.sh [OPTIONS] <dockerhub_username> [tag] [extra_tag...]
#
# Examples:
#   ./publish_to_docker.sh hackerdogs                     # build+push :api :web
#   ./publish_to_docker.sh hackerdogs v1.0.0              # also :api-v1.0.0 :web-v1.0.0
#   ./publish_to_docker.sh --build-only hackerdogs        # build locally, do NOT push
#   ./publish_to_docker.sh --api-only hackerdogs          # only the API image
#   ./publish_to_docker.sh --web-only hackerdogs          # only the Web image
#
# Options:
#   --build-only        Build (load locally) but do not push to Docker Hub
#   --api-only          Build/push only hdsearch:api
#   --web-only          Build/push only hdsearch:web
#   --platforms <list>  Override platforms (default: linux/amd64,linux/arm64)
set -euo pipefail
cd "$(dirname "$0")"

RED=$'\033[0;31m'; GRN=$'\033[0;32m'; YEL=$'\033[1;33m'; NC=$'\033[0m'

PLATFORMS="linux/amd64,linux/arm64"
PUSH=1
DO_API=1
DO_WEB=1
ARGS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --build-only) PUSH=0; shift ;;
    --api-only)   DO_WEB=0; shift ;;
    --web-only)   DO_API=0; shift ;;
    --platforms)  PLATFORMS="$2"; shift 2 ;;
    -h|--help)    sed -n '2,30p' "$0"; exit 0 ;;
    *)            ARGS+=("$1"); shift ;;
  esac
done

USER_NS="${ARGS[0]:-}"
if [ -z "$USER_NS" ]; then
  echo "${RED}Error:${NC} dockerhub_username is required."
  echo "  ./publish_to_docker.sh <dockerhub_username> [tag...]"
  exit 1
fi
TAGS=("${ARGS[@]:1}")
[ ${#TAGS[@]} -eq 0 ] && TAGS=("latest")

if ! docker buildx version >/dev/null 2>&1; then
  echo "${RED}Error:${NC} docker buildx is required (Docker 19.03+ with buildx)."
  exit 1
fi
BUILDER="hdsearch-builder"
if ! docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
  echo "→ creating buildx builder '$BUILDER'"
  docker buildx create --name "$BUILDER" --use --bootstrap >/dev/null
else
  docker buildx use "$BUILDER" >/dev/null
fi

if [ "$PUSH" = 1 ]; then
  if docker login </dev/null 2>&1 | grep -qi "Login Succeeded"; then
    echo "→ authenticated to Docker Hub"
  else
    echo "${YEL}Note:${NC} not authenticated to Docker Hub. Run: docker login -u $USER_NS"
    echo "      (continuing — buildx push will fail if you are not authenticated)"
  fi
fi

build_image() {
  local component="$1" context="$2" dockerfile="$3"
  local tag_args=(-t "${USER_NS}/hdsearch:${component}")
  for t in "${TAGS[@]}"; do
    [ "$t" = "latest" ] && continue
    tag_args+=(-t "${USER_NS}/hdsearch:${component}-${t}")
  done

  echo ""
  echo "${GRN}=== hdsearch:${component} ===${NC} context=${context} platforms=${PLATFORMS} tags=${TAGS[*]}"
  if [ "$PUSH" = 1 ]; then
    docker buildx build --platform "$PLATFORMS" --provenance=false --sbom=false \
      -f "$dockerfile" "${tag_args[@]}" --push "$context"
    echo "${GRN}✓ pushed${NC} ${USER_NS}/hdsearch:${component}"
  else
    docker buildx build --platform "$(uname -m | grep -q arm && echo linux/arm64 || echo linux/amd64)" \
      --provenance=false --sbom=false -f "$dockerfile" "${tag_args[@]}" --load "$context"
    echo "${GRN}✓ built locally${NC} hdsearch:${component} (also ${USER_NS}/hdsearch:${component})"
  fi
}

[ "$DO_API" = 1 ] && build_image "api" "./api" "./api/Dockerfile"
[ "$DO_WEB" = 1 ] && build_image "web" "./web" "./web/Dockerfile"

echo ""
echo "${GRN}Done.${NC}"
if [ "$PUSH" = 1 ]; then
  echo "Pull with:"
  [ "$DO_API" = 1 ] && echo "  docker pull ${USER_NS}/hdsearch:api"
  [ "$DO_WEB" = 1 ] && echo "  docker pull ${USER_NS}/hdsearch:web"
  echo "Set image: in docker-compose.yml to ${USER_NS}/hdsearch:api and ${USER_NS}/hdsearch:web"
fi
