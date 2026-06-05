#!/usr/bin/env bash
set -euo pipefail

runtime_home="${CRAWCLAW_AUTOMATION_HOME:-$HOME/.crawclaw/automation}"
runtime_dir="$runtime_home/n8n"
n8n_version="${N8N_VERSION:-2.23.3}"
n8n_port="${N8N_PORT:-5679}"
npm_prefix="$runtime_dir/npm"
start_script="$runtime_dir/start.sh"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'missing required command: %s\n' "$1" >&2
    exit 2
  fi
}

require_cmd npm

mkdir -p "$runtime_dir" "$npm_prefix"

npm install --prefix "$npm_prefix" --omit=dev "n8n@$n8n_version"

cat > "$start_script" <<EOF
#!/usr/bin/env bash
set -euo pipefail

export N8N_HOST="\${N8N_HOST:-127.0.0.1}"
export N8N_PORT="\${N8N_PORT:-$n8n_port}"
export N8N_USER_FOLDER="\${N8N_USER_FOLDER:-$runtime_dir/user}"

exec "$npm_prefix/node_modules/.bin/n8n" start
EOF
chmod +x "$start_script"

cat > "$runtime_dir/runtime.json" <<EOF
{
  "runtimeId": "n8n",
  "version": "$n8n_version",
  "baseUrl": "http://127.0.0.1:$n8n_port",
  "startScript": "$start_script",
  "installedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

printf 'n8n runtime installed at %s\n' "$runtime_dir"
