#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${1:-${ESPPORT:-/dev/cu.usbmodem1301}}"
BUILD_DIR="${BUILD_DIR:-${ROOT_DIR}/build/esp-box-3}"

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  "${ROOT_DIR}/scripts/build.sh"
fi

UPSTREAM_DIR="$("${ROOT_DIR}/scripts/fetch-upstream.sh")"

"${ROOT_DIR}/scripts/idf.sh" \
  -C "${UPSTREAM_DIR}" \
  -B "${BUILD_DIR}" \
  -p "${PORT}" \
  flash

if [[ "${IDF_MONITOR:-0}" == "1" ]]; then
  "${ROOT_DIR}/scripts/idf.sh" -C "${UPSTREAM_DIR}" -B "${BUILD_DIR}" -p "${PORT}" monitor
fi
