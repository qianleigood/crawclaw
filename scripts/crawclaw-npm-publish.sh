#!/usr/bin/env bash

set -euo pipefail

mode="${1:-}"
publish_target="${2:-}"

if [[ "${mode}" != "--publish" ]]; then
  echo "usage: bash scripts/crawclaw-npm-publish.sh --publish [package.tgz]" >&2
  exit 2
fi

if [[ -n "${publish_target}" && -f "${publish_target}" ]]; then
  case "${publish_target}" in
    /*|./*|../*) ;;
    *) publish_target="./${publish_target}" ;;
  esac
fi

package_metadata="$(
  cargo run --quiet -p crawclaw-runtime -- npm-package-metadata --package-dir . |
    sed '/^\[bubbletea-macros\]/d'
)"
package_version="$(printf '%s\n' "${package_metadata}" | sed -n '2p')"
mapfile -t publish_plan < <(
  cargo run --quiet -p crawclaw-runtime -- npm-publish-plan \
    --version "${package_version}" \
    --root-package \
    --requested-tag "${CRAWCLAW_NPM_PUBLISH_TAG:-beta}" \
    --publish-mode "${mode}" |
    sed '/^\[bubbletea-macros\]/d'
)
release_channel="${publish_plan[0]}"
publish_tag="${publish_plan[1]}"
publish_auth_token="${NODE_AUTH_TOKEN:-${NPM_TOKEN:-}}"
publish_cmd=(npm publish)
if [[ -n "${publish_target}" ]]; then
  publish_cmd+=("${publish_target}")
fi
publish_cmd+=(--access public --tag "${publish_tag}" --provenance)

echo "Resolved package version: ${package_version}"
echo "Resolved release channel: ${release_channel}"
echo "Resolved publish tag: ${publish_tag}"
if [[ -n "${NODE_AUTH_TOKEN:-${NPM_TOKEN:-}}" ]]; then
  echo "Publish auth: npm token"
else
  echo "Publish auth: GitHub OIDC trusted publishing"
fi
if [[ -n "${publish_target}" ]]; then
  echo "Resolved publish target: ${publish_target}"
fi

printf 'Publish command:'
printf ' %q' "${publish_cmd[@]}"
printf '\n'

if [[ -n "${publish_auth_token}" ]]; then
  publish_userconfig="$(mktemp)"
  trap 'rm -f "${publish_userconfig}"' EXIT
  chmod 0600 "${publish_userconfig}"
  printf '%s\n' "//registry.npmjs.org/:_authToken=${publish_auth_token}" > "${publish_userconfig}"
  NPM_CONFIG_USERCONFIG="${publish_userconfig}" "${publish_cmd[@]}"
else
  "${publish_cmd[@]}"
fi
