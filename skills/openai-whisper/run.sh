#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"

if [ ! -d "$VENV_DIR" ]; then
  echo "❌ 未找到 .venv，请先初始化 MLX Whisper 环境"
  exit 1
fi

if [ $# -lt 1 ]; then
  echo "用法: ./run.sh <audio_or_video_path> [model_repo] [--output-format txt|json] [--output /path/file] [--language zh]"
  echo "示例: ./run.sh ./sample.mp4 mlx-community/whisper-turbo --output-format txt"
  exit 1
fi

source "$VENV_DIR/bin/activate"
"$VENV_DIR/bin/python" "$SCRIPT_DIR/transcribe_mlx.py" "$@"
