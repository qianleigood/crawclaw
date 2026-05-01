#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_DIR="${CRAWCLAW_STATE_DIR:-$HOME/.crawclaw}"
VENV_DIR="${CRAWCLAW_OPENAI_WHISPER_VENV:-$STATE_DIR/runtimes/skill-openai-whisper/venv}"

if [ $# -lt 1 ]; then
  echo "用法: ./run.sh <audio_or_video_path> [model_repo] [--output-format txt|json] [--output /path/file] [--language zh]"
  echo "示例: ./run.sh ./sample.mp4 mlx-community/whisper-turbo --output-format txt"
  exit 1
fi

if [ "$(uname -s)" != "Darwin" ] || [ "$(uname -m)" != "arm64" ]; then
  echo "MLX Whisper 需要 macOS Apple Silicon。"
  exit 1
fi

if [ ! -x "$VENV_DIR/bin/python" ]; then
  echo "未找到 MLX Whisper runtime: $VENV_DIR"
  echo "请重新运行项目安装，或执行 crawclaw runtimes repair。"
  exit 1
fi

if ! "$VENV_DIR/bin/python" -c "import mlx_whisper" >/dev/null 2>&1; then
  echo "MLX Whisper runtime 缺少 mlx_whisper。"
  echo "请重新运行项目安装，或执行 crawclaw runtimes repair。"
  exit 1
fi

"$VENV_DIR/bin/python" "$SCRIPT_DIR/transcribe_mlx.py" "$@"
