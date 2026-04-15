#!/bin/bash
# 视频分析工作流 - 启动脚本
# 自动激活虚拟环境并路由到对应子命令

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"

# 检查虚拟环境
if [ ! -d "$VENV_DIR" ]; then
    echo "❌ 虚拟环境不存在"
    echo "请先运行安装脚本：bash scripts/setup.sh"
    exit 1
fi

# 激活虚拟环境
source "$VENV_DIR/bin/activate"

# 加载 .env（如果存在）
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a
  source "$SCRIPT_DIR/.env"
  set +a
fi

export CURRENT_SESSION_KEY="${CURRENT_SESSION_KEY:-}"

cmd="${1:-legacy}"
case "$cmd" in
  submit)
    shift
    python "$SCRIPT_DIR/scripts/submit_job.py" "$@"
    ;;
  status)
    shift
    python "$SCRIPT_DIR/scripts/job_status.py" "$@"
    ;;
  list)
    shift
    python "$SCRIPT_DIR/scripts/job_status.py" --list "$@"
    ;;
  dispatcher)
    shift
    python "$SCRIPT_DIR/scripts/dispatcher.py" "$@"
    ;;
  pause|resume|cancel|retry-failed)
    action="$cmd"
    shift
    python "$SCRIPT_DIR/scripts/job_control.py" "$action" "$@"
    ;;
  legacy|--resume|--restart|--status|--auto-continue|--auto-pause|-*|'')
    python "$SCRIPT_DIR/scripts/analyze_video.py" "$@"
    ;;
  *)
    if [ -f "$cmd" ] || [[ "$cmd" =~ ^https?:// ]] || [[ "$cmd" == *douyin* ]] || [[ "$cmd" == *xiaohongshu* ]] || [[ "$cmd" == *xhslink* ]]; then
      python "$SCRIPT_DIR/scripts/submit_job.py" "$@"
    else
      python "$SCRIPT_DIR/scripts/analyze_video.py" "$@"
    fi
    ;;
esac
