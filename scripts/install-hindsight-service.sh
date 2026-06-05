#!/usr/bin/env bash
# Install CrawClaw's local Hindsight service from the GitHub-hosted deploy files.

set -euo pipefail

REPO="${CRAWCLAW_REPO:-qianleigood/crawclaw}"
REF="${CRAWCLAW_REF:-main}"
SERVICE_DIR="${CRAWCLAW_HINDSIGHT_HOME:-${HOME}/.crawclaw/hindsight-service}"
API_PORT="${CRAWCLAW_HINDSIGHT_PORT:-8888}"
WEB_PORT="${CRAWCLAW_HINDSIGHT_WEB_PORT:-9999}"
MODEL_PROFILE="${CRAWCLAW_HINDSIGHT_MODEL_PROFILE:-auto}"
RAW_BASE="https://raw.githubusercontent.com/${REPO}/${REF}"

log() {
  printf '[crawclaw-hindsight] %s\n' "$*"
}

need_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "ERROR: missing required command: $1"
    exit 1
  fi
}

download() {
  local path="$1"
  local dest="$2"
  curl -fsSL "${RAW_BASE}/${path}" -o "${dest}"
}

compose() {
  docker compose "$@"
}

is_positive_integer() {
  case "$1" in
    '' | *[!0-9]*)
      return 1
      ;;
  esac
  [ "$1" -gt 0 ]
}

detect_memory_mib() {
  if is_positive_integer "${CRAWCLAW_HINDSIGHT_MEMORY_MIB:-}"; then
    printf '%s\n' "${CRAWCLAW_HINDSIGHT_MEMORY_MIB}"
    return
  fi
  if command -v sysctl >/dev/null 2>&1; then
    local mem_bytes
    mem_bytes="$(sysctl -n hw.memsize 2>/dev/null || true)"
    if is_positive_integer "${mem_bytes}"; then
      printf '%s\n' $((mem_bytes / 1024 / 1024))
      return
    fi
  fi
  if [ -r /proc/meminfo ]; then
    awk '/^MemTotal:/ { printf "%d\n", $2 / 1024; exit }' /proc/meminfo
    return
  fi
  printf '0\n'
}

detect_cpu_cores() {
  if is_positive_integer "${CRAWCLAW_HINDSIGHT_CPU_CORES:-}"; then
    printf '%s\n' "${CRAWCLAW_HINDSIGHT_CPU_CORES}"
    return
  fi
  if command -v getconf >/dev/null 2>&1; then
    local cores
    cores="$(getconf _NPROCESSORS_ONLN 2>/dev/null || true)"
    if is_positive_integer "${cores}"; then
      printf '%s\n' "${cores}"
      return
    fi
  fi
  if command -v sysctl >/dev/null 2>&1; then
    local cores
    cores="$(sysctl -n hw.logicalcpu 2>/dev/null || true)"
    if is_positive_integer "${cores}"; then
      printf '%s\n' "${cores}"
      return
    fi
  fi
  printf '0\n'
}

wait_for_health() {
  local health_url="http://127.0.0.1:${API_PORT}/health"
  local elapsed=0
  local timeout="${CRAWCLAW_HINDSIGHT_HEALTH_TIMEOUT:-900}"

  log "waiting for Hindsight health at ${health_url}"
  while [ "${elapsed}" -lt "${timeout}" ]; do
    if curl -fsS "${health_url}" >/dev/null 2>&1; then
      log "Hindsight is ready"
      return 0
    fi
    sleep 5
    elapsed=$((elapsed + 5))
  done

  log "ERROR: Hindsight did not become ready within ${timeout}s"
  log "If this is a first run, model downloads may still be in progress."
  compose -f "${SERVICE_DIR}/docker-compose.yml" --env-file "${SERVICE_DIR}/.env" logs hindsight | tail -40 || true
  exit 1
}

select_auto_model_profile() {
  if [ "${DETECTED_MEMORY_MIB}" -eq 0 ] || [ "${DETECTED_CPU_CORES}" -eq 0 ]; then
    AUTO_PROFILE_REASON="hardware detection incomplete; preserving Chinese quality default"
    SELECTED_MODEL_PROFILE="zh-quality"
    return
  fi
  if [ "${DETECTED_MEMORY_MIB}" -ge 16384 ] && [ "${DETECTED_CPU_CORES}" -ge 6 ]; then
    AUTO_PROFILE_REASON="detected >=16 GiB memory and >=6 CPU cores"
    SELECTED_MODEL_PROFILE="zh-quality"
    return
  fi
  AUTO_PROFILE_REASON="detected limited local resources; keeping bge-m3 and disabling local reranker"
  SELECTED_MODEL_PROFILE="zh-balanced"
}

resolve_model_profile() {
  DETECTED_MEMORY_MIB="$(detect_memory_mib)"
  DETECTED_CPU_CORES="$(detect_cpu_cores)"
  if ! is_positive_integer "${DETECTED_MEMORY_MIB}"; then
    DETECTED_MEMORY_MIB=0
  fi
  if ! is_positive_integer "${DETECTED_CPU_CORES}"; then
    DETECTED_CPU_CORES=0
  fi
  AUTO_PROFILE_REASON=""
  SELECTED_MODEL_PROFILE="${MODEL_PROFILE}"
  if [ "${MODEL_PROFILE}" = "auto" ]; then
    select_auto_model_profile
  fi

  case "${SELECTED_MODEL_PROFILE}" in
    zh-quality)
      EMBEDDINGS_MODEL="${CRAWCLAW_HINDSIGHT_EMBEDDINGS_MODEL:-BAAI/bge-m3}"
      RERANKER_PROVIDER="${CRAWCLAW_HINDSIGHT_RERANKER_PROVIDER:-local}"
      RERANKER_MODEL="${CRAWCLAW_HINDSIGHT_RERANKER_MODEL:-BAAI/bge-reranker-v2-m3}"
      ;;
    zh-balanced)
      EMBEDDINGS_MODEL="${CRAWCLAW_HINDSIGHT_EMBEDDINGS_MODEL:-BAAI/bge-m3}"
      RERANKER_PROVIDER="${CRAWCLAW_HINDSIGHT_RERANKER_PROVIDER:-rrf}"
      RERANKER_MODEL="${CRAWCLAW_HINDSIGHT_RERANKER_MODEL:-}"
      ;;
    fast)
      EMBEDDINGS_MODEL="${CRAWCLAW_HINDSIGHT_EMBEDDINGS_MODEL:-BAAI/bge-small-en-v1.5}"
      RERANKER_PROVIDER="${CRAWCLAW_HINDSIGHT_RERANKER_PROVIDER:-rrf}"
      RERANKER_MODEL="${CRAWCLAW_HINDSIGHT_RERANKER_MODEL:-}"
      ;;
    *)
      log "ERROR: unsupported CRAWCLAW_HINDSIGHT_MODEL_PROFILE=${MODEL_PROFILE}"
      log "Supported values: auto, zh-quality, zh-balanced, fast"
      exit 1
      ;;
  esac
}

read_env_value() {
  local env_path="$1"
  local key="$2"
  if [ ! -f "${env_path}" ]; then
    return
  fi
  awk -F= -v key="${key}" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "${env_path}"
}

configured_value() {
  local override_name="$1"
  local env_path="$2"
  local key="$3"
  local default_value="$4"
  local override_value="${!override_name:-}"
  if [ -n "${override_value}" ]; then
    printf '%s\n' "${override_value}"
    return
  fi
  local existing_value
  existing_value="$(read_env_value "${env_path}" "${key}")"
  if [ -n "${existing_value}" ]; then
    printf '%s\n' "${existing_value}"
    return
  fi
  printf '%s\n' "${default_value}"
}

print_model_plan() {
  log "requested model profile: ${MODEL_PROFILE}"
  log "detected memory MiB: ${DETECTED_MEMORY_MIB}"
  log "detected CPU cores: ${DETECTED_CPU_CORES}"
  log "selected model profile: ${SELECTED_MODEL_PROFILE}"
  if [ -n "${AUTO_PROFILE_REASON}" ]; then
    log "selection reason: ${AUTO_PROFILE_REASON}"
  fi
  log "embedding model: ${EMBEDDINGS_MODEL}"
  log "reranker provider: ${RERANKER_PROVIDER}"
  if [ -n "${RERANKER_MODEL}" ]; then
    log "reranker model: ${RERANKER_MODEL}"
  fi
}

write_env() {
  local env_path="${SERVICE_DIR}/.env"
  local llm_provider_value
  local llm_api_key_value
  local llm_model_value
  local llm_base_url_value
  if [ -f "${env_path}" ] && [ "${CRAWCLAW_HINDSIGHT_OVERWRITE_ENV:-0}" != "1" ]; then
    log "updating generated settings in ${env_path} and preserving existing LLM values"
  fi
  llm_provider_value="$(configured_value CRAWCLAW_HINDSIGHT_LLM_PROVIDER "${env_path}" HINDSIGHT_API_LLM_PROVIDER "")"
  llm_api_key_value="$(configured_value CRAWCLAW_HINDSIGHT_LLM_API_KEY "${env_path}" HINDSIGHT_API_LLM_API_KEY "")"
  llm_model_value="$(configured_value CRAWCLAW_HINDSIGHT_LLM_MODEL "${env_path}" HINDSIGHT_API_LLM_MODEL "")"
  llm_base_url_value="$(configured_value CRAWCLAW_HINDSIGHT_LLM_BASE_URL "${env_path}" HINDSIGHT_API_LLM_BASE_URL "")"

  cat >"${env_path}" <<EOF
# CrawClaw local Hindsight service.
# Generated by scripts/install-hindsight-service.sh from ${REPO}@${REF}.

HINDSIGHT_API_PORT=${API_PORT}
HINDSIGHT_API_HOST=0.0.0.0
HINDSIGHT_WEB_PORT=${WEB_PORT}

# Model profile: auto selects the strongest Chinese profile the detected
# hardware can support. Model files are cached by Docker in the
# hindsight-model-cache volume.
CRAWCLAW_HINDSIGHT_MODEL_PROFILE=${MODEL_PROFILE}
CRAWCLAW_HINDSIGHT_SELECTED_MODEL_PROFILE=${SELECTED_MODEL_PROFILE}
CRAWCLAW_HINDSIGHT_DETECTED_MEMORY_MIB=${DETECTED_MEMORY_MIB}
CRAWCLAW_HINDSIGHT_DETECTED_CPU_CORES=${DETECTED_CPU_CORES}
HINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL=${EMBEDDINGS_MODEL}
HINDSIGHT_API_RERANKER_PROVIDER=${RERANKER_PROVIDER}
HINDSIGHT_API_RERANKER_LOCAL_MODEL=${RERANKER_MODEL}
HINDSIGHT_API_TEXT_SEARCH_EXTENSION=${CRAWCLAW_HINDSIGHT_TEXT_SEARCH_EXTENSION:-native}
HINDSIGHT_API_TEXT_SEARCH_EXTENSION_NATIVE_LANGUAGE=${CRAWCLAW_HINDSIGHT_TEXT_SEARCH_LANGUAGE:-simple}
HF_HOME=/home/hindsight/.cache/huggingface
HUGGINGFACE_HUB_CACHE=/home/hindsight/.cache/huggingface/hub
TRANSFORMERS_CACHE=/home/hindsight/.cache/huggingface/transformers
SENTENCE_TRANSFORMERS_HOME=/home/hindsight/.cache/sentence-transformers
HF_ENDPOINT=${CRAWCLAW_HINDSIGHT_HF_ENDPOINT:-}

# Optional LLM settings for memory extraction. Export these before running the
# installer or edit this file after installation.
HINDSIGHT_API_LLM_PROVIDER=${llm_provider_value}
HINDSIGHT_API_LLM_API_KEY=${llm_api_key_value}
HINDSIGHT_API_LLM_MODEL=${llm_model_value}
HINDSIGHT_API_LLM_BASE_URL=${llm_base_url_value}
EOF
  chmod 600 "${env_path}"
}

main() {
  resolve_model_profile
  if [ "${CRAWCLAW_HINDSIGHT_PLAN_ONLY:-0}" = "1" ]; then
    print_model_plan
    return
  fi

  need_command curl
  need_command docker
  if ! docker compose version >/dev/null 2>&1; then
    log "ERROR: Docker Compose v2 is required"
    exit 1
  fi

  mkdir -p "${SERVICE_DIR}"
  log "installing service files into ${SERVICE_DIR}"
  download "deploy/hindsight/docker-compose.yml" "${SERVICE_DIR}/docker-compose.yml"
  write_env

  print_model_plan
  if [ -n "${CRAWCLAW_HINDSIGHT_HF_ENDPOINT:-}" ]; then
    log "Hugging Face endpoint: ${CRAWCLAW_HINDSIGHT_HF_ENDPOINT}"
  fi
  log "model cache: Docker volume hindsight-model-cache"
  log "first run may take several minutes while models download"

  log "starting Hindsight"
  compose -f "${SERVICE_DIR}/docker-compose.yml" --env-file "${SERVICE_DIR}/.env" up -d
  wait_for_health

  cat <<EOF

CrawClaw Hindsight local service is running.

API: http://127.0.0.1:${API_PORT}
Web: http://127.0.0.1:${WEB_PORT}
Service directory: ${SERVICE_DIR}

Desktop memory policy:
{
  "hindsightEnabled": true,
  "hindsightBaseUrl": "http://127.0.0.1:${API_PORT}",
  "hindsightMode": "local",
  "hindsightManaged": false,
  "hindsightLifecycleStatus": "external"
}

EOF
}

main "$@"
