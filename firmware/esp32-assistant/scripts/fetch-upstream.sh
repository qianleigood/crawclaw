#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM_DIR="${ROOT_DIR}/upstream/xiaozhi-esp32"
XIAOZHI_REPO="${XIAOZHI_REPO:-https://github.com/78/xiaozhi-esp32.git}"
XIAOZHI_REF="${XIAOZHI_REF:-v2.2.6}"
XIAOZHI_EXPECTED_COMMIT="${XIAOZHI_EXPECTED_COMMIT:-49ac8a6da399f27a9546d4f73640b7f86c24bac6}"

mkdir -p "$(dirname "${UPSTREAM_DIR}")"

if [[ -d "${UPSTREAM_DIR}/.git" ]]; then
  git -C "${UPSTREAM_DIR}" fetch --depth 1 origin tag "${XIAOZHI_REF}" >/dev/null 2>&1 \
    || git -C "${UPSTREAM_DIR}" fetch --depth 1 origin "${XIAOZHI_REF}" >/dev/null
else
  git clone --depth 1 --branch "${XIAOZHI_REF}" "${XIAOZHI_REPO}" "${UPSTREAM_DIR}"
fi

git -C "${UPSTREAM_DIR}" switch --detach "${XIAOZHI_REF}" >/dev/null 2>&1

actual_commit="$(git -C "${UPSTREAM_DIR}" rev-parse HEAD)"
if [[ -n "${XIAOZHI_EXPECTED_COMMIT}" && "${actual_commit}" != "${XIAOZHI_EXPECTED_COMMIT}" ]]; then
  echo "xiaozhi-esp32 ${XIAOZHI_REF} resolved to ${actual_commit}, expected ${XIAOZHI_EXPECTED_COMMIT}" >&2
  exit 1
fi

echo "${UPSTREAM_DIR}"
