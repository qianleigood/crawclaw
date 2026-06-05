#!/usr/bin/env bash
set -euo pipefail

runtime_home="${CRAWCLAW_AUTOMATION_HOME:-$HOME/.crawclaw/automation}"
runtime_dir="$runtime_home/n8n"
n8n_version="${N8N_VERSION:-2.23.3}"
n8n_port="${N8N_PORT:-5679}"
npm_prefix="$runtime_dir/npm"
start_script="$runtime_dir/start.sh"
selected_node_bin=""
selected_npm_bin=""
selected_node_version=""

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'missing required command: %s\n' "$1" >&2
    exit 2
  fi
}

node_bin_for_npm() {
  local npm_bin="$1"
  local npm_dir
  npm_dir="$(cd "$(dirname "$npm_bin")" && pwd)"
  if [ -x "$npm_dir/node" ]; then
    printf '%s/node\n' "$npm_dir"
    return
  fi
  command -v node 2>/dev/null || true
}

node_version() {
  "$1" -p 'process.versions.node' 2>/dev/null || true
}

node_supported_for_n8n() {
  local version="$1"
  local major minor
  major="${version%%.*}"
  minor="${version#*.}"
  minor="${minor%%.*}"

  case "$major" in
    22)
      [ "${minor:-0}" -ge 22 ]
      ;;
    23 | 24)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

consider_npm_bin() {
  local npm_bin="$1"
  [ -n "$npm_bin" ] || return 1
  [ -x "$npm_bin" ] || return 1

  local node_bin version
  node_bin="$(node_bin_for_npm "$npm_bin")"
  [ -n "$node_bin" ] || return 1
  [ -x "$node_bin" ] || return 1
  version="$(node_version "$node_bin")"
  [ -n "$version" ] || return 1
  node_supported_for_n8n "$version" || return 1

  selected_npm_bin="$npm_bin"
  selected_node_bin="$node_bin"
  selected_node_version="$version"
}

resolve_npm_bin() {
  local candidates=()
  if [ -n "${N8N_NPM_BIN:-}" ]; then
    candidates+=("$N8N_NPM_BIN")
  fi
  if command -v npm >/dev/null 2>&1; then
    candidates+=("$(command -v npm)")
  fi
  candidates+=(
    "/usr/local/bin/npm"
    "/opt/homebrew/opt/node@24/bin/npm"
    "/opt/homebrew/opt/node@22/bin/npm"
    "/opt/homebrew/bin/npm"
  )

  local candidate seen=":"
  for candidate in "${candidates[@]}"; do
    [ -n "$candidate" ] || continue
    case "$seen" in
      *":$candidate:"*) continue ;;
    esac
    seen="$seen$candidate:"
    if consider_npm_bin "$candidate"; then
      return 0
    fi
  done

  printf 'n8n requires Node 22.22.x, 23.x, or 24.x. Set N8N_NPM_BIN to a compatible npm binary.\n' >&2
  if command -v node >/dev/null 2>&1; then
    printf 'current node: %s (%s)\n' "$(command -v node)" "$(node --version 2>/dev/null || true)" >&2
  fi
  exit 2
}

resolve_npm_bin

mkdir -p "$runtime_dir" "$npm_prefix"

if [ -z "${PYTHON:-}" ] && command -v python3.11 >/dev/null 2>&1; then
  export PYTHON
  PYTHON="$(command -v python3.11)"
fi

"$selected_npm_bin" install --prefix "$npm_prefix" --omit=dev "n8n@$n8n_version"

cat > "$start_script" <<EOF
#!/usr/bin/env bash
set -euo pipefail

export N8N_HOST="\${N8N_HOST:-127.0.0.1}"
export N8N_PORT="\${N8N_PORT:-$n8n_port}"
export N8N_USER_FOLDER="\${N8N_USER_FOLDER:-$runtime_dir/user}"
export PATH="$(dirname "$selected_node_bin"):\$PATH"

exec "$selected_node_bin" "$npm_prefix/node_modules/n8n/bin/n8n" start
EOF
chmod +x "$start_script"

cat > "$runtime_dir/runtime.json" <<EOF
{
  "runtimeId": "n8n",
  "version": "$n8n_version",
  "node": "$selected_node_bin",
  "nodeVersion": "$selected_node_version",
  "baseUrl": "http://127.0.0.1:$n8n_port",
  "startScript": "$start_script",
  "installedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

printf 'n8n runtime installed at %s\n' "$runtime_dir"
