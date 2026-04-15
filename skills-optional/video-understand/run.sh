#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"

if [ ! -d "$VENV_DIR" ]; then
  echo "❌ 未找到 .venv，请先初始化视频理解技能环境"
  exit 1
fi

source "$VENV_DIR/bin/activate"
exec python "$SCRIPT_DIR/video_analyzer.py" "$@"
