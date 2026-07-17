#!/usr/bin/env bash
# Poll an HTTP URL until it returns the expected status (default 200) or timeout.
# Usage: wait-for-url.sh <url> [expected_code] [timeout_sec] [label]
set -euo pipefail
URL="${1:?url required}"
EXPECT="${2:-200}"
TIMEOUT="${3:-30}"
LABEL="${4:-$URL}"

for i in $(seq 1 "$TIMEOUT"); do
  code=$(curl -s -m 2 -o /dev/null -w "%{http_code}" "$URL" 2>/dev/null || echo 000)
  if [ "$code" = "$EXPECT" ]; then
    echo "   ${LABEL} OK (${i}s)"
    exit 0
  fi
  sleep 1
done

code=$(curl -s -m 2 -o /dev/null -w "%{http_code}" "$URL" 2>/dev/null || echo 000)
echo "   ${LABEL} FAILED — HTTP ${code} after ${TIMEOUT}s"
exit 1
