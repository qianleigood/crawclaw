#!/usr/bin/env bash
# Hindsight 生产环境更新脚本
# 用法：./scripts/update.sh [hindsight|all]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TARGET="${1:-hindsight}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

cd "${PROJECT_DIR}"

# --- 备份 ---
log "更新前备份..."
if [[ -x scripts/backup.sh ]]; then
  scripts/backup.sh
fi

# --- 拉取新镜像 ---
log "拉取新镜像..."
case "${TARGET}" in
  hindsight)
    docker compose -f docker-compose.prod.yml pull hindsight
    ;;
  all)
    docker compose -f docker-compose.prod.yml pull
    ;;
  *)
    log "ERROR: 未知目标 '${TARGET}'，可选: hindsight, all"
    exit 1
    ;;
esac

# --- 滚动更新 ---
log "滚动更新 ${TARGET}..."
if [[ "${TARGET}" == "all" ]]; then
  docker compose -f docker-compose.prod.yml up -d
else
  docker compose -f docker-compose.prod.yml up -d "${TARGET}"
fi

# --- 等待就绪 ---
log "等待服务就绪..."
MAX_WAIT=120
ELAPSED=0
while [[ ${ELAPSED} -lt ${MAX_WAIT} ]]; do
  if curl -sf http://localhost:8888/health &>/dev/null; then
    log "✅ 更新完成，服务正常"
    exit 0
  fi
  sleep 5
  ((ELAPSED+=5))
done

log "ERROR: 更新后服务未就绪"
docker compose -f docker-compose.prod.yml logs hindsight | tail -20
exit 1
