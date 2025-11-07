#!/bin/sh
set -e
CONTAINER="$1"
TARGET_DIR="$2"
if [ -z "$CONTAINER" ] || [ -z "$TARGET_DIR" ]; then
  echo "Usage: $0 <container_name> <target_dir>"
  exit 1
fi
docker exec -u 0 -it "$CONTAINER" bash -lc "mkdir -p $TARGET_DIR"
docker cp "$BASE/dist/." "$CONTAINER":"$TARGET_DIR"/
docker restart "$CONTAINER"
echo "✅ Deploy complete."
