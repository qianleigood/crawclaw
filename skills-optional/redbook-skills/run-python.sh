#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$ROOT_DIR/.venv312"
REQ_FILE="$ROOT_DIR/requirements.txt"
STAMP_FILE="$VENV_DIR/.requirements.sha256"

if ! command -v python3.12 >/dev/null 2>&1; then
  echo "[run-python] Error: python3.12 not found in PATH." >&2
  echo "[run-python] This skill requires Python 3.12+ because the upstream code uses Python 3.10+ type syntax." >&2
  exit 1
fi

if [ ! -x "$VENV_DIR/bin/python" ]; then
  echo "[run-python] Creating Python 3.12 virtualenv at $VENV_DIR" >&2
  python3.12 -m venv "$VENV_DIR"
fi

REQ_HASH="$(shasum -a 256 "$REQ_FILE" | awk '{print $1}')"
CURRENT_HASH=""
if [ -f "$STAMP_FILE" ]; then
  CURRENT_HASH="$(cat "$STAMP_FILE" 2>/dev/null || true)"
fi

if [ "$REQ_HASH" != "$CURRENT_HASH" ]; then
  echo "[run-python] Syncing dependencies from requirements.txt" >&2
  "$VENV_DIR/bin/python" -m pip install --upgrade pip >&2
  "$VENV_DIR/bin/python" -m pip install -r "$REQ_FILE" >&2
  printf '%s' "$REQ_HASH" > "$STAMP_FILE"
fi

exec "$VENV_DIR/bin/python" "$@"
