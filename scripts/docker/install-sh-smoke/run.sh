#!/usr/bin/env bash
set -euo pipefail

INSTALL_URL="${CRAWCLAW_INSTALL_URL:-${CRAWCLAW_INSTALL_URL:-https://crawclaw.ai/install.sh}}"
SMOKE_PREVIOUS_VERSION="${CRAWCLAW_INSTALL_SMOKE_PREVIOUS:-${CRAWCLAW_INSTALL_SMOKE_PREVIOUS:-}}"
SKIP_PREVIOUS="${CRAWCLAW_INSTALL_SMOKE_SKIP_PREVIOUS:-${CRAWCLAW_INSTALL_SMOKE_SKIP_PREVIOUS:-0}}"
DEFAULT_PACKAGE="crawclaw"
PACKAGE_NAME="${CRAWCLAW_INSTALL_PACKAGE:-${CRAWCLAW_INSTALL_PACKAGE:-$DEFAULT_PACKAGE}}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# shellcheck source=../install-sh-common/cli-verify.sh
source "$SCRIPT_DIR/../install-sh-common/cli-verify.sh"

echo "==> Resolve npm versions"
if [[ "$SKIP_PREVIOUS" == "1" ]]; then
  LATEST_VERSION="$(npm view "$PACKAGE_NAME" version)"
  PREVIOUS_VERSION="$LATEST_VERSION"
elif [[ -n "$SMOKE_PREVIOUS_VERSION" ]]; then
  LATEST_VERSION="$(npm view "$PACKAGE_NAME" version)"
  PREVIOUS_VERSION="$SMOKE_PREVIOUS_VERSION"
else
  LATEST_VERSION="$(npm view "$PACKAGE_NAME" dist-tags.latest)"
  VERSIONS_JSON="$(npm view "$PACKAGE_NAME" versions --json)"
  PREVIOUS_VERSION="$(LATEST_VERSION="$LATEST_VERSION" VERSIONS_JSON="$VERSIONS_JSON" node - <<'NODE'
const latest = String(process.env.LATEST_VERSION || "");
const raw = process.env.VERSIONS_JSON || "[]";
let versions;
try {
  versions = JSON.parse(raw);
} catch {
  versions = raw ? [raw] : [];
}
if (!Array.isArray(versions)) {
  versions = [versions];
}
if (versions.length === 0 || latest.length === 0) {
  process.exit(1);
}
const latestIndex = versions.lastIndexOf(latest);
if (latestIndex <= 0) {
  process.stdout.write(latest);
  process.exit(0);
}
process.stdout.write(String(versions[latestIndex - 1] ?? latest));
NODE
)"
fi

echo "package=$PACKAGE_NAME latest=$LATEST_VERSION previous=$PREVIOUS_VERSION"

if [[ "$SKIP_PREVIOUS" == "1" ]]; then
  echo "==> Skip preinstall previous (CRAWCLAW_INSTALL_SMOKE_SKIP_PREVIOUS=1)"
else
  echo "==> Preinstall previous (forces installer upgrade path)"
  npm install -g "${PACKAGE_NAME}@${PREVIOUS_VERSION}"
fi

echo "==> Run official installer one-liner"
curl --retry 5 --retry-delay 3 --retry-all-errors --connect-timeout 20 -fsSL "$INSTALL_URL" | bash

echo "==> Verify installed version"
if [[ -n "${CRAWCLAW_INSTALL_LATEST_OUT:-${CRAWCLAW_INSTALL_LATEST_OUT:-}}" ]]; then
  printf "%s" "$LATEST_VERSION" > "${CRAWCLAW_INSTALL_LATEST_OUT:-${CRAWCLAW_INSTALL_LATEST_OUT:-}}"
fi
verify_installed_cli "$PACKAGE_NAME" "$LATEST_VERSION"

echo "OK"
