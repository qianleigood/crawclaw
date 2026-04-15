#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-}"

if [[ -z "${PYTHON_BIN}" ]]; then
  for c in /opt/homebrew/bin/python3.12 python3.12 python3.11 python3.10; do
    if command -v "$c" >/dev/null 2>&1; then
      PYTHON_BIN="$(command -v "$c")"
      break
    fi
  done
fi

if [[ -z "${PYTHON_BIN}" ]]; then
  echo "未找到 Python 3.10+，请先安装 python3.12。" >&2
  exit 1
fi

"${PYTHON_BIN}" - <<'PY'
import sys
assert sys.version_info >= (3,10), f"需要 Python >= 3.10，当前为 {sys.version}"
print(sys.version)
PY

REQ="$ROOT/requirements.txt"
cd "$ROOT"
"${PYTHON_BIN}" -m venv .venv
source .venv/bin/activate
"$ROOT/.venv/bin/python" -m pip install -U pip setuptools wheel
"$ROOT/.venv/bin/python" -m pip install -r "$REQ"

echo
echo "环境已就绪：$ROOT/.venv"
echo "激活命令：source $ROOT/.venv/bin/activate"
