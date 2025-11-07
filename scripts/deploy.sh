#!/usr/bin/env bash
set -euo pipefail

CONTAINER="${1:-NodeRedModule}"
DEST="${2:-/data-internal/dist}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Building TypeScript…"
(cd "$ROOT" && npm run build)

echo "Pushing dist/ into container '$CONTAINER' -> $DEST"
docker exec -u 0 -it "$CONTAINER" sh -lc "rm -rf '$DEST' && mkdir -p '$DEST'"
docker cp "$ROOT/dist/." "$CONTAINER":"$DEST"/

echo "Sanity check inside container:"
docker exec -u 0 -it "$CONTAINER" node -e "const lib=require('$DEST'); console.log({ok:!!lib, keys:Object.keys(lib), version:lib.VERSION})"

echo "Restarting Node-RED container…"
docker restart "$CONTAINER"
echo "✅ Deploy complete."
