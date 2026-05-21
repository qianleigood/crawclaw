#!/usr/bin/env bash

set -euo pipefail

mode="${1:-}"
package_dir="${2:-}"

if [[ "${mode}" != "--dry-run" && "${mode}" != "--publish" ]]; then
  echo "usage: bash scripts/plugin-npm-publish.sh [--dry-run|--publish] <package-dir>" >&2
  exit 2
fi

if [[ -z "${package_dir}" ]]; then
  echo "missing package dir" >&2
  exit 2
fi

package_metadata="$(
  cargo run --quiet -p crawclaw-repo-tools -- npm-package-metadata --package-dir "${package_dir}" |
    sed '/^\[bubbletea-macros\]/d'
)"
package_name="$(printf '%s\n' "${package_metadata}" | sed -n '1p')"
package_version="$(printf '%s\n' "${package_metadata}" | sed -n '2p')"
current_beta_version="$(npm view "${package_name}" dist-tags.beta 2>/dev/null || true)"
publish_plan_output="$(
  cargo run --quiet -p crawclaw-repo-tools -- npm-publish-plan \
    --version "${package_version}" \
    --current-beta-version "${current_beta_version}" \
    --publish-mode "${mode}" |
    sed '/^\[bubbletea-macros\]/d'
)"
release_channel="$(printf '%s\n' "${publish_plan_output}" | sed -n '1p')"
publish_tag="$(printf '%s\n' "${publish_plan_output}" | sed -n '2p')"
mirror_dist_tags_csv="$(printf '%s\n' "${publish_plan_output}" | sed -n '3p')"
mirror_auth_source="$(printf '%s\n' "${publish_plan_output}" | sed -n '4p')"
mirror_auth_requirement="$(printf '%s\n' "${publish_plan_output}" | sed -n '5p')"
mirror_auth_source="${mirror_auth_source:-none}"
mirror_auth_requirement="${mirror_auth_requirement:-optional}"
publish_cmd=(npm publish --access public --tag "${publish_tag}" --provenance)

echo "Resolved package dir: ${package_dir}"
echo "Resolved package name: ${package_name}"
echo "Resolved package version: ${package_version}"
echo "Current beta dist-tag: ${current_beta_version:-<missing>}"
echo "Resolved release channel: ${release_channel}"
echo "Resolved publish tag: ${publish_tag}"
echo "Resolved mirror dist-tags: ${mirror_dist_tags_csv:-<none>}"
echo "Publish auth: GitHub OIDC trusted publishing"
echo "Mirror dist-tag auth source: ${mirror_auth_source}"
echo "Mirror dist-tag auth requirement: ${mirror_auth_requirement}"

mirror_auth_token=""
case "${mirror_auth_source}" in
  node-auth-token)
    mirror_auth_token="${NODE_AUTH_TOKEN:-}"
    ;;
  npm-token)
    mirror_auth_token="${NPM_TOKEN:-}"
    ;;
esac

if [[ "${mirror_auth_requirement}" == "required" && -z "${mirror_auth_token}" ]]; then
  echo "npm dist-tag mirroring requires explicit npm auth via NODE_AUTH_TOKEN or NPM_TOKEN." >&2
  echo "Refusing publish before npm latest/beta promotion can diverge." >&2
  exit 1
fi

printf 'Publish command:'
printf ' %q' "${publish_cmd[@]}"
printf '\n'

if [[ "${mode}" == "--dry-run" ]]; then
  exit 0
fi

(
  cd "${package_dir}"
  "${publish_cmd[@]}"

  if [[ -n "${mirror_dist_tags_csv}" ]]; then
    mirror_userconfig="$(mktemp)"
    trap 'rm -f "${mirror_userconfig}"' EXIT
    chmod 0600 "${mirror_userconfig}"
    printf '%s\n' "//registry.npmjs.org/:_authToken=${mirror_auth_token}" > "${mirror_userconfig}"

    IFS=',' read -r -a mirror_dist_tags <<< "${mirror_dist_tags_csv}"
    for dist_tag in "${mirror_dist_tags[@]}"; do
      [[ -n "${dist_tag}" ]] || continue
      echo "Mirroring ${package_name}@${package_version} onto dist-tag ${dist_tag}"
      NPM_CONFIG_USERCONFIG="${mirror_userconfig}" \
        npm dist-tag add "${package_name}@${package_version}" "${dist_tag}"
    done
  fi
)
