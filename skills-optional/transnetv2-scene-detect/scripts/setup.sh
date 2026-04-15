#!/usr/bin/env bash
set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$SCRIPTS_DIR/.." && pwd)"
VENV_DIR="$SKILL_DIR/.venv"

/opt/homebrew/bin/python3.12 --version >/dev/null

if [ ! -d "$VENV_DIR" ]; then
  echo "📦 创建虚拟环境: $VENV_DIR"
  /opt/homebrew/bin/python3.12 -m venv "$VENV_DIR"
fi

source "$VENV_DIR/bin/activate"
"$VENV_DIR/bin/python" -m pip install --upgrade pip setuptools wheel
"$VENV_DIR/bin/python" -m pip install -r "$SKILL_DIR/requirements.txt"

echo "✅ 安装完成"
echo "运行方式: $SKILL_DIR/run.sh <video_path>"
