#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <command> [args...]"
  echo "Example: $0 npm -s test"
  exit 2
fi

NODE_VERSION="${LOCAL_NODE_VERSION:-v20.18.0}"
NODE_DIR="/tmp/node-${NODE_VERSION}-linux-x64"
NODE_ARCHIVE="node-${NODE_VERSION}-linux-x64.tar.xz"
NODE_URL="https://nodejs.org/dist/${NODE_VERSION}/${NODE_ARCHIVE}"

if [ ! -x "${NODE_DIR}/bin/node" ]; then
  echo "Installing local Node runtime ${NODE_VERSION} into /tmp ..."
  curl -fsSL "${NODE_URL}" -o "/tmp/${NODE_ARCHIVE}"
  tar -xJf "/tmp/${NODE_ARCHIVE}" -C /tmp
fi

export PATH="${NODE_DIR}/bin:${PATH}"
export TMPDIR=/tmp
export TMP=/tmp
export TEMP=/tmp

exec "$@"
