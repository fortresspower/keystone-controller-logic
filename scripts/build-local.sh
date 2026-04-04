#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

# Ensure no stale artifacts remain from previous builds.
rm -rf dist
./scripts/with-local-node.sh npm run -s build

# Stage runtime templates alongside compiled JS output.
mkdir -p dist/templates
cp -f src/templates/*.json dist/templates/
