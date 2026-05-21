#!/usr/bin/env bash
set -eo pipefail

original_path="${PATH}"

if command -v idf.py >/dev/null 2>&1; then
  exec idf.py "$@"
fi

if [[ -n "${IDF_PATH:-}" && -f "${IDF_PATH}/export.sh" ]]; then
  idf_version_dir="$(basename "$(dirname "${IDF_PATH}")")"
  eim_activation="${IDF_TOOLS_PATH:-${HOME}/.espressif/tools}/activate_idf_${idf_version_dir}.sh"
  if [[ -f "${eim_activation}" ]]; then
    while IFS='=' read -r key value; do
      if [[ "${key}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
        export "${key}=${value}"
      fi
    done < <("${eim_activation}" -e)
    export PATH="${PATH}:${original_path}"
    if [[ -n "${IDF_PYTHON_ENV_PATH:-}" && -x "${IDF_PYTHON_ENV_PATH}/bin/python" ]]; then
      exec "${IDF_PYTHON_ENV_PATH}/bin/python" "${IDF_PATH}/tools/idf.py" "$@"
    fi
    if command -v idf.py >/dev/null 2>&1; then
      exec idf.py "$@"
    fi
  fi

  # shellcheck disable=SC1090
  source "${IDF_PATH}/export.sh"
  exec idf.py "$@"
fi

echo "idf.py was not found. Activate ESP-IDF or set IDF_PATH before running this script." >&2
exit 127
