#!/usr/bin/env bash
# Hindsight PostgreSQL 数据库恢复脚本
# 用法：./scripts/restore.sh <backup_file.sql.gz>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CONTAINER="crawclaw-postgres"

if [[ $# -lt 1 ]]; then
  echo "用法: $0 <backup_file.sql.gz>"
  echo ""
  echo "可用备份:"
  ls -lh "${PROJECT_DIR}/backups"/hindsight_*.sql.gz 2>/dev/null || echo "  （无备份文件）"
  exit 1
fi

BACKUP_FILE="$1"

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "ERROR: 备份文件不存在: ${BACKUP_FILE}"
  exit 1
fi

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# --- 确认 ---
echo "⚠️  警告：此操作将覆盖当前数据库中的所有数据"
echo "   备份文件: ${BACKUP_FILE}"
echo "   目标容器: ${CONTAINER}"
read -rp "确认恢复？(yes/no): " confirm
if [[ "${confirm}" != "yes" ]]; then
  echo "已取消"
  exit 0
fi

# --- 停止 Hindsight ---
log "停止 Hindsight 服务..."
cd "${PROJECT_DIR}"
docker compose stop hindsight 2>/dev/null || docker compose -f docker-compose.prod.yml stop hindsight

# --- 恢复 ---
log "开始恢复..."
gunzip -c "${BACKUP_FILE}" | docker exec -i "${CONTAINER}" pg_restore \
  -U hindsight \
  -d hindsight \
  --clean \
  --if-exists \
  --verbose \
  2>&1 | tail -20

# --- 重启 ---
log "重启 Hindsight..."
docker compose start hindsight 2>/dev/null || docker compose -f docker-compose.prod.yml start hindsight

log "恢复完成，请检查服务状态"
