#!/usr/bin/env bash
set -euo pipefail

APPLY_RESULT="${1:-/data-internal/runtime/apply-site-config-result.json}"
CONTAINER="${2:-NodeRedModule}"
HEALTH_URL="${3:-http://127.0.0.1:1880/api/control/status}"
TIMEOUT_SEC="${TIMEOUT_SEC:-90}"
PATCHER="${PATCHER:-$(dirname "$0")/apply-node-red-fixed-slots.py}"
RESULT_FILE="${RESULT_FILE:-/data-internal/runtime/site-config-apply-result.json}"

if [ ! -f "$APPLY_RESULT" ]; then
  echo "Apply result not found: $APPLY_RESULT" >&2
  exit 2
fi

read_restart_required() {
  if command -v jq >/dev/null 2>&1; then
    jq -r 'if .restartRequired == true then "true" else "false" end' "$APPLY_RESULT"
    return
  fi

  if command -v node >/dev/null 2>&1; then
    node -e '
      const fs = require("fs");
      const file = process.argv[1];
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      process.stdout.write(data.restartRequired === true ? "true" : "false");
    ' "$APPLY_RESULT"
    return
  fi

  if command -v python3 >/dev/null 2>&1; then
    python3 - "$APPLY_RESULT" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as fh:
    data = json.load(fh)
print("true" if data.get("restartRequired") is True else "false", end="")
PY
    return
  fi

  if grep -Eq '"restartRequired"[[:space:]]*:[[:space:]]*true' "$APPLY_RESULT"; then
    printf true
  else
    printf false
  fi
}

RESTART_REQUIRED="$(read_restart_required)"

if [ "$RESTART_REQUIRED" != "true" ]; then
  echo "No Node-RED restart required."
  exit 0
fi

echo "Restart required by siteConfig topology change."
tmpdir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmpdir"
}
trap cleanup EXIT

status_json="$tmpdir/control-status.json"
config_json="$tmpdir/control-config.json"
flows_json="$tmpdir/flows.json"
global_json="$tmpdir/global.json"

echo "Reading runtime slot plan from $HEALTH_URL"
fetch_status() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 5 "$HEALTH_URL"
    return
  fi

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
  ' "$HEALTH_URL"
}
fetch_status > "$status_json"

echo "Reading persisted control config before stopping Node-RED"
fetch_control_config() {
  docker exec "$CONTAINER" node -e '
    const http = require("http");
    const data = JSON.stringify({ method: "GetControlConfig" });
    const req = http.request({
      hostname: "127.0.0.1",
      port: 1880,
      path: "/api/esr",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => body += chunk);
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          console.error(`HTTP ${res.statusCode}: ${body.slice(0, 300)}`);
          process.exit(1);
        }
        const parsed = JSON.parse(body);
        const config = parsed?.data?.config || parsed?.config;
        if (!config || typeof config !== "object") {
          console.error("GetControlConfig returned no config");
          process.exit(1);
        }
        process.stdout.write(JSON.stringify(config));
      });
    });
    req.on("error", (error) => {
      console.error(error && error.message ? error.message : String(error));
      process.exit(1);
    });
    req.write(data);
    req.end();
  '
}
fetch_control_config > "$config_json"

echo "Stopping container: $CONTAINER"
docker stop "$CONTAINER" >/dev/null

echo "Patching fixed Modbus slots in flows.json"
docker cp "$CONTAINER:/data/node-red/flows.json" "$flows_json"
python3 "$PATCHER" "$flows_json" "$status_json"
docker cp "$flows_json" "$CONTAINER:/data/node-red/flows.json"

if docker cp "$CONTAINER:/data/node-red/context/global/global.json" "$global_json" >/dev/null 2>&1; then
  python3 - "$global_json" "$config_json" <<'PY'
import json
import sys

path, config_path = sys.argv[1:3]
with open(path, "r", encoding="utf-8") as fh:
    data = json.load(fh)
with open(config_path, "r", encoding="utf-8") as fh:
    config = json.load(fh)
for key in ("controlConfig", "unifiedControlConfig", "siteConfig"):
    data[key] = config
for key in (
    "restartRequired",
    "telemetryReaderConfig",
    "writerTargets",
    "telemetryRouteMap",
    "writerRouteMap",
    "telemetryEquipmentConfig",
    "ss40kLookup",
    "ss40kEquipmentToProfile",
    "ss40kModelIndexMap",
    "platformWriterState",
    "telemetry",
    "NEW_telemetry",
):
    data.pop(key, None)
for key in list(data.keys()):
    if key.startswith("telemetryState:"):
        data.pop(key, None)
with open(path, "w", encoding="utf-8") as fh:
    json.dump(data, fh, separators=(",", ":"))
PY
  docker cp "$global_json" "$CONTAINER:/data/node-red/context/global/global.json"
fi

cleanup_flow_context() {
  local container_path="$1"
  local local_path="$2"
  if docker cp "$CONTAINER:$container_path" "$local_path" >/dev/null 2>&1; then
    python3 - "$local_path" "$config_json" <<'PY'
import json
import sys

path, config_path = sys.argv[1:3]
with open(path, "r", encoding="utf-8") as fh:
    data = json.load(fh)
with open(config_path, "r", encoding="utf-8") as fh:
    config = json.load(fh)
for key in ("controlConfig", "unifiedControlConfig", "siteConfig"):
    data[key] = config
for key in (
    "restartRequired",
    "telemetryReaderConfig",
    "writerTargets",
    "telemetryRouteMap",
    "writerRouteMap",
    "telemetryEquipmentConfig",
    "ss40kLookup",
    "ss40kEquipmentToProfile",
    "ss40kModelIndexMap",
    "platformWriterState",
    "telemetry",
    "NEW_telemetry",
):
    data.pop(key, None)
for key in list(data.keys()):
    if key.startswith("telemetryState:"):
        data.pop(key, None)
with open(path, "w", encoding="utf-8") as fh:
    json.dump(data, fh, separators=(",", ":"))
PY
    docker cp "$local_path" "$CONTAINER:$container_path"
  fi
}

cleanup_flow_context "/data/node-red/context/unified_platform_tab/flow.json" "$tmpdir/unified-platform-flow.json"

echo "Starting container: $CONTAINER"
docker start "$CONTAINER" >/dev/null

echo "Waiting for Node-RED at $HEALTH_URL"
deadline=$((SECONDS + TIMEOUT_SEC))
while [ "$SECONDS" -lt "$deadline" ]; do
  if fetch_status >/dev/null 2>&1; then
    echo "Node-RED is reachable."
    mkdir -p "$(dirname "$RESULT_FILE")" 2>/dev/null || true
    python3 - "$status_json" "$RESULT_FILE" <<'PY'
import json
import sys
from datetime import datetime, timezone

status_path, result_path = sys.argv[1:3]
with open(status_path, "r", encoding="utf-8") as fh:
    raw = json.load(fh)
status = raw.get("data") or raw.get("status") or raw
result = {
    "ok": True,
    "appliedAt": datetime.now(timezone.utc).isoformat(),
    "systemProfile": status.get("systemProfile"),
    "restartRequired": False,
    "message": "NodeRedModule restarted and fixed Modbus slots applied",
}
with open(result_path, "w", encoding="utf-8") as fh:
    json.dump(result, fh, indent=2)
PY
    exit 0
  fi
  sleep 2
done

echo "Node-RED did not become reachable within ${TIMEOUT_SEC}s." >&2
docker ps --filter "name=$CONTAINER" --format "table {{.Names}}\t{{.Status}}" >&2 || true
exit 1
