#!/usr/bin/env bash
set -euo pipefail

cd /repo

export CRAWCLAW_STATE_DIR="/tmp/crawclaw-test"
export CRAWCLAW_CONFIG_PATH="${CRAWCLAW_STATE_DIR}/crawclaw.json"

echo "==> Build"
pnpm build

echo "==> Seed state"
mkdir -p "${CRAWCLAW_STATE_DIR}/credentials"
mkdir -p "${CRAWCLAW_STATE_DIR}/agents/main/sessions"
echo '{}' >"${CRAWCLAW_CONFIG_PATH}"
echo 'creds' >"${CRAWCLAW_STATE_DIR}/credentials/marker.txt"
echo 'session' >"${CRAWCLAW_STATE_DIR}/agents/main/sessions/sessions.json"

echo "==> Reset (config+creds+sessions)"
pnpm crawclaw reset --scope config+creds+sessions --yes --non-interactive

test ! -f "${CRAWCLAW_CONFIG_PATH}"
test ! -d "${CRAWCLAW_STATE_DIR}/credentials"
test ! -d "${CRAWCLAW_STATE_DIR}/agents/main/sessions"

echo "==> Recreate minimal config"
mkdir -p "${CRAWCLAW_STATE_DIR}/credentials"
echo '{}' >"${CRAWCLAW_CONFIG_PATH}"

echo "==> Uninstall (state only)"
pnpm crawclaw uninstall --state --yes --non-interactive

test ! -d "${CRAWCLAW_STATE_DIR}"

echo "OK"
