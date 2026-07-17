#!/usr/bin/env bash
# Canonical entrypoint: pull + build + start the FULL hdsearch stack in DOCKER via
# docker compose — shared hd-redis + API + Web + openserp + searxng on the hdnet
# network (crawl4ai / browserless / tor-proxy / db / embedder are reused). Creates
# the hdnet network and the DB roles if PG_SUPER_PASSWORD is provided.
#
#   ./start_hdsearch_docker.sh                       # up + build + migrate
#   PG_SUPER_PASSWORD='…' ./start_hdsearch_docker.sh # also create DB roles/schema
#   ./start_hdsearch_docker.sh down                  # tear down
exec "$(dirname "$0")/start_hd_search_stack.sh" "$@"
