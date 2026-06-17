#!/usr/bin/env bash
set -euo pipefail

CONTAINER="${CONTAINER:-NodeRedModule}"
STATUS_URL="${STATUS_URL:-http://127.0.0.1:1880/api/control/status}"
POLL_SEC="${POLL_SEC:-5}"
DEBOUNCE_SEC="${DEBOUNCE_SEC:-2}"
RUNTIME_DIR="${RUNTIME_DIR:-/tmp/node-red-apply-supervisor}"
APPLY_REQUEST="${APPLY_REQUEST:-$RUNTIME_DIR/site-config-apply-request.json}"
APPLY_RESULT="${APPLY_RESULT:-$RUNTIME_DIR/site-config-apply-result.json}"
APPLY_SCRIPT="${APPLY_SCRIPT:-$(dirname "$0")/restart-nodered-if-required.sh}"

mkdir -p "$RUNTIME_DIR"

fetch_status() {
  docker exec "$CONTAINER" node -e '
    const http = require("http");
    const url = process.argv[1];
    http.get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => body += chunk);
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          console.error(`HTTP ${res.statusCode}: ${body.slice(0, 300)}`);
          process.exit(1);
        }
        process.stdout.write(body);
      });
    }).on("error", (error) => {
      console.error(error && error.message ? error.message : String(error));
      process.exit(1);
    });
  ' "$STATUS_URL"
}

restart_required() {
  python3 - "$1" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as fh:
    raw = json.load(fh)
status = raw.get("data") or raw.get("status") or raw
restart = status.get("restartRequired")
if restart is True or (isinstance(restart, dict) and restart.get("restartRequired") is True):
    print("true", end="")
else:
    print("false", end="")
PY
}

write_apply_request() {
  python3 - "$1" "$APPLY_REQUEST" <<'PY'
import json
import sys
from datetime import datetime, timezone

status_path, request_path = sys.argv[1:3]
with open(status_path, "r", encoding="utf-8") as fh:
    raw = json.load(fh)
status = raw.get("data") or raw.get("status") or raw
request = {
    "restartRequired": True,
    "requestedAt": datetime.now(timezone.utc).isoformat(),
    "systemProfile": status.get("systemProfile"),
    "reason": status.get("restartRequired"),
}
with open(request_path, "w", encoding="utf-8") as fh:
    json.dump(request, fh, indent=2)
PY
}

echo "Node-RED apply supervisor watching $CONTAINER every ${POLL_SEC}s"
while true; do
  status_file="$RUNTIME_DIR/control-status.json"
  if fetch_status > "$status_file" 2>"$RUNTIME_DIR/last-error.log"; then
    if [ "$(restart_required "$status_file")" = "true" ]; then
      echo "restartRequired detected; applying fixed slots"
      write_apply_request "$status_file"
      sleep "$DEBOUNCE_SEC"
      if RESULT_FILE="$APPLY_RESULT" "$APPLY_SCRIPT" "$APPLY_REQUEST" "$CONTAINER" "$STATUS_URL"; then
        echo "apply complete"
      else
        code=$?
        echo "apply failed with code $code" >&2
        python3 - "$APPLY_RESULT" "$code" <<'PY'
import json
import sys
from datetime import datetime, timezone

path, code = sys.argv[1:3]
with open(path, "w", encoding="utf-8") as fh:
    json.dump({
        "ok": False,
        "appliedAt": datetime.now(timezone.utc).isoformat(),
        "exitCode": int(code),
        "message": "NodeRedModule fixed-slot apply failed",
    }, fh, indent=2)
PY
      fi
    fi
  fi
  sleep "$POLL_SEC"
done
