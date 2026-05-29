#!/usr/bin/env bash
# Hindsight PostgreSQL 数据库备份脚本
# 用法：./scripts/backup.sh [--full | --schema-only]
# 建议通过 cron 定期执行：0 3 * * * /path/to/backup.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${BACKUP_DIR:-${PROJECT_DIR}/backups}"
RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-30}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
CONTAINER="crawclaw-postgres"

# 加载 .env
if [[ -f "${PROJECT_DIR}/.env" ]]; then
  set -a; source "${PROJECT_DIR}/.env"; set +a
fi

mkdir -p "${BACKUP_DIR}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# --- 检查容器 ---
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  log "ERROR: PostgreSQL 容器 ${CONTAINER} 未运行"
  exit 1
fi

# --- 执行备份 ---
BACKUP_FILE="${BACKUP_DIR}/hindsight_${TIMESTAMP}.sql.gz"
log "开始备份 → ${BACKUP_FILE}"

docker exec "${CONTAINER}" pg_dump \
  -U hindsight \
  -d hindsight \
  --format=custom \
  --compress=9 \
  --verbose \
  2>/dev/null | gzip > "${BACKUP_FILE}"

BACKUP_SIZE="$(du -h "${BACKUP_FILE}" | cut -f1)"
log "备份完成：${BACKUP_SIZE}"

# --- 校验 ---
if [[ ! -s "${BACKUP_FILE}" ]]; then
  log "ERROR: 备份文件为空"
  rm -f "${BACKUP_FILE}"
  exit 1
fi

# --- 清理过期备份 ---
CLEANED=0
while IFS= read -r old_file; do
  rm -f "${old_file}"
  ((CLEANED++))
done < <(find "${BACKUP_DIR}" -name "hindsight_*.sql.gz" -mtime "+${RETAIN_DAYS}" -type f 2>/dev/null)

if [[ ${CLEANED} -gt 0 ]]; then
  log "已清理 ${CLEANED} 个过期备份（>${RETAIN_DAYS} 天）"
fi

# --- 写入备份清单 ---
cat >> "${BACKUP_DIR}/backup.log" << EOF
${TIMESTAMP}  ${BACKUP_FILE}  ${BACKUP_SIZE}
EOF

log "备份流程结束"
