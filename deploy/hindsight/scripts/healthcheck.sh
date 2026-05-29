#!/usr/bin/env bash
# Hindsight 健康检查脚本
# 用法：./scripts/healthcheck.sh [--verbose]
# 建议通过 cron 定期执行：*/5 * * * * /path/to/healthcheck.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
VERBOSE="${1:-}"
ERRORS=0

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
ok()   { echo "  ✅ $*"; }
fail() { echo "  ❌ $*"; ((ERRORS++)); }

log "=== Hindsight 健康检查 ==="

# --- 1. 容器状态 ---
log "容器状态:"
for name in crawclaw-hindsight crawclaw-postgres crawclaw-nginx crawclaw-prometheus crawclaw-grafana; do
  status=$(docker inspect -f '{{.State.Status}}' "${name}" 2>/dev/null || echo "not_found")
  if [[ "${status}" == "running" ]]; then
    ok "${name}: running"
  else
    fail "${name}: ${status}"
  fi
done

# --- 2. API 健康 ---
log "API 健康:"
if result=$(curl -sf http://localhost:8888/health 2>/dev/null); then
  ok "Hindsight API: ${result}"
else
  fail "Hindsight API: 不可达"
fi

# --- 3. 数据库连接 ---
log "数据库:"
if docker exec crawclaw-postgres pg_isready -U hindsight -d hindsight &>/dev/null; then
  ok "PostgreSQL: 就绪"
  # 检查 pgroonga 扩展
  if docker exec crawclaw-postgres psql -U hindsight -d hindsight -c "SELECT 1 FROM pg_extension WHERE extname='pgroonga'" -t 2>/dev/null | grep -q 1; then
    ok "pgroonga: 已安装"
  else
    fail "pgroonga: 未安装"
  fi
else
  fail "PostgreSQL: 不可达"
fi

# --- 4. TLS 证书 ---
log "TLS 证书:"
CERT_FILE="${PROJECT_DIR}/nginx/certs/fullchain.pem"
if [[ -f "${CERT_FILE}" ]]; then
  EXPIRY=$(openssl x509 -enddate -noout -in "${CERT_FILE}" 2>/dev/null | cut -d= -f2)
  if [[ -n "${EXPIRY}" ]]; then
    EXPIRY_TS=$(date -j -f "%b %d %T %Y %Z" "${EXPIRY}" +%s 2>/dev/null || date -d "${EXPIRY}" +%s 2>/dev/null || echo 0)
    NOW_TS=$(date +%s)
    DAYS_LEFT=$(( (EXPIRY_TS - NOW_TS) / 86400 ))
    if [[ ${DAYS_LEFT} -gt 30 ]]; then
      ok "证书有效，${DAYS_LEFT} 天后过期"
    elif [[ ${DAYS_LEFT} -gt 0 ]]; then
      fail "证书即将过期：${DAYS_LEFT} 天"
    else
      fail "证书已过期"
    fi
  fi
else
  fail "证书文件不存在: ${CERT_FILE}"
fi

# --- 5. 磁盘空间 ---
log "磁盘空间:"
DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}' | tr -d '%')
if [[ ${DISK_USAGE} -lt 80 ]]; then
  ok "磁盘使用率: ${DISK_USAGE}%"
elif [[ ${DISK_USAGE} -lt 90 ]]; then
  fail "磁盘使用率偏高: ${DISK_USAGE}%"
else
  fail "磁盘空间严重不足: ${DISK_USAGE}%"
fi

# --- 6. 备份状态 ---
log "备份状态:"
BACKUP_DIR="${PROJECT_DIR}/backups"
LATEST_BACKUP=$(ls -t "${BACKUP_DIR}"/hindsight_*.sql.gz 2>/dev/null | head -1)
if [[ -n "${LATEST_BACKUP}" ]]; then
  BACKUP_AGE=$(( ($(date +%s) - $(stat -f %m "${LATEST_BACKUP}" 2>/dev/null || stat -c %Y "${LATEST_BACKUP}" 2>/dev/null)) / 86400 ))
  if [[ ${BACKUP_AGE} -le 1 ]]; then
    ok "最新备份: $(basename "${LATEST_BACKUP}") (${BACKUP_AGE} 天前)"
  else
    fail "最新备份过旧: ${BACKUP_AGE} 天前"
  fi
else
  fail "未找到备份文件"
fi

# --- 结果 ---
echo ""
if [[ ${ERRORS} -eq 0 ]]; then
  log "✅ 所有检查通过"
else
  log "❌ 发现 ${ERRORS} 个问题"
fi

exit ${ERRORS}
