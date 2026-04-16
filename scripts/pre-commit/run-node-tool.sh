#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COREPACK_PNPM_SHIM_DIR="$ROOT_DIR/scripts/bin"

run_pnpm_exec() {
  local tool_name="$1"
  shift

  if command -v pnpm >/dev/null 2>&1; then
    exec pnpm exec "$tool_name" "$@"
  fi

  if command -v corepack >/dev/null 2>&1 && corepack pnpm --version >/dev/null 2>&1; then
    PATH="$COREPACK_PNPM_SHIM_DIR:$PATH" exec corepack pnpm exec "$tool_name" "$@"
  fi
}

if [[ $# -lt 1 ]]; then
  echo "usage: run-node-tool.sh <tool> [args...]" >&2
  exit 2
fi

tool="$1"
shift

if [[ -f "$ROOT_DIR/pnpm-lock.yaml" ]]; then
  run_pnpm_exec "$tool" "$@"
fi

if { [[ -f "$ROOT_DIR/bun.lockb" ]] || [[ -f "$ROOT_DIR/bun.lock" ]]; } && command -v bun >/dev/null 2>&1; then
  exec bunx --bun "$tool" "$@"
fi

if command -v npm >/dev/null 2>&1; then
  exec npm exec -- "$tool" "$@"
fi

if command -v npx >/dev/null 2>&1; then
  exec npx "$tool" "$@"
fi

echo "Missing package manager: pnpm, bun, or npm required." >&2
exit 1
