#!/usr/bin/env bash
# Canonical entrypoint: start ALL hdsearch services LOCALLY in the background —
# API (:8791) + Web UI (:3030) + shared hd-redis (:6379 db 2) + openserp (:7007) +
# searxng (:8899), reusing the shared crawl4ai / browserless / tor-proxy / embedder
# containers. Generates secrets, migrates the DB, health-checks.
#
#   ./start_hdsearch.sh                              # start everything
#   WEB_PORT=3040 ./start_hdsearch.sh                # change the web port
#   PG_SUPER_PASSWORD='…' ./start_hdsearch.sh        # also create DB roles/schema
#   ./start_hdsearch.sh dev                          # dev/watch mode
#   ./start_hdsearch.sh --foreground                 # run attached (stream logs, Ctrl-C stops)
#   ./stop_hd_search.sh                              # stop
exec "$(dirname "$0")/start_hd_search_all.sh" "$@"
