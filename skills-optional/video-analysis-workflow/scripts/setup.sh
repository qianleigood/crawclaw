#!/bin/bash
# 视频分析工作流 - 安装脚本

set -e

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPTS_DIR/.." && pwd)"
VENV_DIR="$SKILL_DIR/.venv"
PYTHON_BIN="/opt/homebrew/bin/python3.12"

echo "🎬 视频分析工作流 - 安装脚本"
echo "================================"
echo ""

# 1. 检查 Python 版本
printf "📌 检查 Python 版本... "
"$PYTHON_BIN" --version || { echo "❌ 找不到 $PYTHON_BIN"; exit 1; }

# 2. 检查虚拟环境
if [ -d "$VENV_DIR" ]; then
    echo "ℹ️  虚拟环境已存在：$VENV_DIR"
    read -p "是否重新创建？(y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "🗑️  删除旧虚拟环境..."
        rm -rf "$VENV_DIR"
    else
        echo "✅ 使用现有虚拟环境"
    fi
fi

# 3. 创建虚拟环境
if [ ! -d "$VENV_DIR" ]; then
    echo "📦 创建虚拟环境：$VENV_DIR"
    "$PYTHON_BIN" -m venv "$VENV_DIR"
    echo "✅ 虚拟环境创建完成"
fi

# 4. 激活虚拟环境
source "$VENV_DIR/bin/activate"

# 5. 升级 pip
echo "📈 升级 pip..."
pip install --upgrade pip

# 6. 安装依赖
echo "📥 安装依赖..."
pip install -r "$SKILL_DIR/requirements.txt"

# 7. 验证安装
echo ""
echo "✅ 验证安装..."
python - <<'PY'
import requests, cv2, torch
print('   ✓ requests:', requests.__version__)
print('   ✓ opencv:', cv2.__version__)
print('   ✓ torch:', torch.__version__)
PY

# 8. 输出当前推荐用法
echo ""
echo "================================"
echo "✅ 安装完成！"
echo ""
echo "使用方法："
echo "  1. 推荐：./run.sh submit \"video.mp4\""
echo "  2. 查看任务：./run.sh list / ./run.sh status <job_id>"
echo "  3. 排障时前台运行调度器：./run.sh dispatcher"
echo "  4. 若需自动飞书发送：./run.sh submit <video_or_url> --send-feishu --feishu-open-id <open_id>"
echo ""
