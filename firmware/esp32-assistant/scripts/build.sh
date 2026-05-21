#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM_DIR="$("${ROOT_DIR}/scripts/fetch-upstream.sh")"
BUILD_DIR="${BUILD_DIR:-${ROOT_DIR}/build/esp-box-3}"
PROFILE_DIR="${ROOT_DIR}/profiles/esp-box-3"

defaults=(
  "${UPSTREAM_DIR}/sdkconfig.defaults"
  "${UPSTREAM_DIR}/sdkconfig.defaults.esp32s3"
  "${PROFILE_DIR}/sdkconfig.defaults"
)

if [[ -f "${PROFILE_DIR}/sdkconfig.local" ]]; then
  defaults+=("${PROFILE_DIR}/sdkconfig.local")
fi

sdkconfig_defaults="$(IFS=';'; echo "${defaults[*]}")"

if [[ -d "${BUILD_DIR}" && ! -f "${BUILD_DIR}/CMakeCache.txt" ]]; then
  rm -rf "${BUILD_DIR}"
fi

"${ROOT_DIR}/scripts/idf.sh" \
  -C "${UPSTREAM_DIR}" \
  -B "${BUILD_DIR}" \
  -D "SDKCONFIG=${BUILD_DIR}/sdkconfig" \
  -D "SDKCONFIG_DEFAULTS=${sdkconfig_defaults}" \
  set-target esp32s3 build
