#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"

if [ ! -d "$VENV_DIR" ]; then
  echo "❌ 未找到 .venv，请先初始化环境"
  echo "运行：bash scripts/setup.sh"
  exit 1
fi

if [ $# -lt 1 ]; then
  echo "用法: ./run.sh <video_path> [--threshold 0.3] [--output output/xxx_scenes.json]"
  echo "未传 --output 时，会自动保存到 output/<视频名>_<时间戳>_scenes.json，并刷新 output/scenes.json latest 快照"
  exit 1
fi

source "$VENV_DIR/bin/activate"
"$VENV_DIR/bin/python" "$SCRIPT_DIR/scripts/run_transnetv2_light.py" "$@"
