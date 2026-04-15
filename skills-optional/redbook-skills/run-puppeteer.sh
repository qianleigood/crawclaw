#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_DIR="$ROOT_DIR/node"

if ! command -v node >/dev/null 2>&1; then
  echo "[run-puppeteer] Error: node not found in PATH." >&2
  exit 1
fi

if [ ! -d "$NODE_DIR/node_modules/puppeteer-core" ]; then
  echo "[run-puppeteer] Installing Node dependencies in $NODE_DIR" >&2
  (cd "$NODE_DIR" && npm install) >&2
fi

exec node "$NODE_DIR/bin/xhs-cli.js" "$@"
