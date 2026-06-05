#!/usr/bin/env bash
set -euo pipefail

runtime_home="${CRAWCLAW_AUTOMATION_HOME:-$HOME/.crawclaw/automation}"
runtime_dir="$runtime_home/comfyui"
comfy_repo="${COMFYUI_REPO:-https://github.com/comfyanonymous/ComfyUI.git}"
comfy_ref="${COMFYUI_REF:-5aa71b9bc28809a16596bb9fa3d0a6300d8e3f0e}"
comfy_port="${COMFYUI_PORT:-8188}"
comfy_dir="$runtime_dir/ComfyUI"
venv_dir="$runtime_dir/venv"
start_script="$runtime_dir/start.sh"
compute_profile="${COMFYUI_COMPUTE_PROFILE:-auto}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'missing required command: %s\n' "$1" >&2
    exit 2
  fi
}

detect_compute_profile() {
  case "$(uname -s):$(uname -m)" in
    Darwin:arm64)
      printf 'apple-metal\n'
      return
      ;;
  esac

  if command -v nvidia-smi >/dev/null 2>&1; then
    printf 'nvidia-cuda\n'
    return
  fi

  printf 'cpu\n'
}

pytorch_index_url_for_profile() {
  case "$1" in
    nvidia-cuda)
      printf 'https://download.pytorch.org/whl/cu126\n'
      ;;
    amd-rocm)
      printf 'https://download.pytorch.org/whl/rocm7.1\n'
      ;;
    intel-xpu)
      printf 'https://download.pytorch.org/whl/xpu\n'
      ;;
  esac
}

install_pytorch() {
  local python_bin="$1"
  local profile="$2"

  case "$profile" in
    external)
      return
      ;;
    apple-metal | cpu)
      if [ -n "${PYTORCH_INDEX_URL:-}" ]; then
        "$python_bin" -m pip install --upgrade --index-url "$PYTORCH_INDEX_URL" torch torchvision torchaudio
      else
        "$python_bin" -m pip install --upgrade torch torchvision torchaudio
      fi
      ;;
    nvidia-cuda | amd-rocm | intel-xpu)
      local index_url="${PYTORCH_INDEX_URL:-$(pytorch_index_url_for_profile "$profile")}"
      if [ -z "$index_url" ]; then
        printf '%s requires PYTORCH_INDEX_URL for the current PyTorch wheel channel\n' "$profile" >&2
        exit 2
      fi
      "$python_bin" -m pip install --upgrade --index-url "$index_url" torch torchvision torchaudio
      ;;
    *)
      printf 'unsupported ComfyUI compute profile: %s\n' "$profile" >&2
      exit 2
      ;;
  esac
}

require_cmd git
require_cmd python3

mkdir -p "$runtime_dir"

if [ "$compute_profile" = "auto" ]; then
  compute_profile="$(detect_compute_profile)"
fi

if [ "$compute_profile" = "external" ]; then
  cat > "$runtime_dir/runtime.json" <<EOF
{
  "runtimeId": "comfyui",
  "computeProfile": "external",
  "baseUrl": "${COMFYUI_EXTERNAL_BASE_URL:-http://127.0.0.1:$comfy_port}",
  "installedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
  printf 'ComfyUI external runtime binding written to %s\n' "$runtime_dir"
  exit 0
fi

checkout_comfy_ref() {
  git -C "$comfy_dir" fetch --depth 1 origin "$comfy_ref"
  git -C "$comfy_dir" checkout --detach FETCH_HEAD
}

if [ -d "$comfy_dir/.git" ]; then
  checkout_comfy_ref
elif [ -e "$comfy_dir" ]; then
  printf 'ComfyUI path exists but is not a git checkout: %s\n' "$comfy_dir" >&2
  exit 2
else
  git clone --no-checkout "$comfy_repo" "$comfy_dir"
  checkout_comfy_ref
fi

python3 -m venv "$venv_dir"
"$venv_dir/bin/python" -m pip install --upgrade pip wheel
install_pytorch "$venv_dir/bin/python" "$compute_profile"

if [ -f "$comfy_dir/requirements.txt" ]; then
  "$venv_dir/bin/python" -m pip install --upgrade -r "$comfy_dir/requirements.txt"
fi

cat > "$start_script" <<EOF
#!/usr/bin/env bash
set -euo pipefail

exec "$venv_dir/bin/python" "$comfy_dir/main.py" --listen "\${COMFYUI_HOST:-127.0.0.1}" --port "\${COMFYUI_PORT:-$comfy_port}"
EOF
chmod +x "$start_script"

cat > "$runtime_dir/runtime.json" <<EOF
{
  "runtimeId": "comfyui",
  "computeProfile": "$compute_profile",
  "baseUrl": "http://127.0.0.1:$comfy_port",
  "startScript": "$start_script",
  "installedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

printf 'ComfyUI runtime installed at %s with profile %s\n' "$runtime_dir" "$compute_profile"
