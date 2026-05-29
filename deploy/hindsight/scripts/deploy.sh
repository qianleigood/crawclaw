#!/usr/bin/env bash
# Hindsight 生产环境首次部署脚本
# 用法：./scripts/deploy.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

cd "${PROJECT_DIR}"

# --- 前置检查 ---
log "=== 前置检查 ==="

if ! command -v docker &>/dev/null; then
  log "ERROR: docker 未安装"
  exit 1
fi

if ! docker compose version &>/dev/null; then
  log "ERROR: docker compose v2 未安装"
  exit 1
fi

if [[ ! -f ".env" ]]; then
  log "未找到 .env，从模板创建..."
  if [[ -f ".env.prod" ]]; then
    cp .env.prod .env
    log "⚠️  请编辑 .env 填入实际值，然后重新运行此脚本"
    exit 0
  else
    log "ERROR: .env.prod 模板也不存在"
    exit 1
  fi
fi

# 检查必要变量
source .env
for var in POSTGRES_PASSWORD LLM_API_KEY; do
  if [[ -z "${!var:-}" ]] || [[ "${!var}" == *"CHANGE_ME"* ]]; then
    log "ERROR: .env 中 ${var} 未设置或仍为默认值"
    exit 1
  fi
done

# --- TLS 证书 ---
CERT_DIR="nginx/certs"
mkdir -p "${CERT_DIR}"
if [[ ! -f "${CERT_DIR}/fullchain.pem" ]]; then
  log "未找到 TLS 证书"
  log "生成自签名证书（仅用于测试）..."
  openssl req -x509 -nodes -days 365 \
    -newkey rsa:2048 \
    -keyout "${CERT_DIR}/privkey.pem" \
    -out "${CERT_DIR}/fullchain.pem" \
    -subj "/CN=hindsight.your-domain.com" \
    2>/dev/null
  log "⚠️  生产环境请替换为正式证书"
fi

# --- 创建备份目录 ---
mkdir -p backups

# --- 拉取镜像 ===
log "=== 拉取镜像 ==="
docker compose -f docker-compose.prod.yml pull

# --- 启动 ===
log "=== 启动服务 ==="
docker compose -f docker-compose.prod.yml up -d

# --- 等待就绪 ===
log "等待服务就绪..."
MAX_WAIT=180
ELAPSED=0
while [[ ${ELAPSED} -lt ${MAX_WAIT} ]]; do
  if curl -sf http://localhost:8888/health &>/dev/null; then
    log "✅ Hindsight API 就绪"
    break
  fi
  sleep 5
  ((ELAPSED+=5))
  log "  等待中... (${ELAPSED}s/${MAX_WAIT}s)"
done

if [[ ${ELAPSED} -ge ${MAX_WAIT} ]]; then
  log "ERROR: Hindsight 未在 ${MAX_WAIT}s 内就绪"
  docker compose -f docker-compose.prod.yml logs hindsight | tail -30
  exit 1
fi

# --- 验证 ===
log "=== 验证 ==="
log "Hindsight: $(curl -sf http://localhost:8888/health || echo 'FAIL')"
log "Prometheus: $(curl -sf http://localhost:9091/-/healthy || echo 'FAIL')"
log "Grafana: $(curl -sf http://localhost:3000/api/health || echo 'FAIL')"

log ""
log "=== 部署完成 ==="
log "  API:       https://localhost:443"
log "  Grafana:   http://localhost:3000"
log "  Prometheus: http://localhost:9091"
log ""
log "下一步："
log "  1. 将 deploy/hindsight/crawclaw-config.json5 合并到 ~/.crawclaw/crawclaw.json"
log "  2. 设置定时备份: crontab -e → 0 3 * * * $(realpath scripts/backup.sh)"
