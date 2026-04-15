#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:-$BASE_DIR/tmp/smoke-test-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$OUT_DIR"

HELP_TXT="$OUT_DIR/start_login_help.txt"
XHS_OK_JSON="$OUT_DIR/xhs_ok.json"
XHS_FAIL_JSON="$OUT_DIR/xhs_fail.json"
DOUYIN_JSON="$OUT_DIR/douyin_blocked.json"

node "$BASE_DIR/scripts/start_login.js" --help > "$HELP_TXT"
grep -q "Usage: node scripts/start_login.js" "$HELP_TXT"
echo "start_login_help_assert_ok"

set +e
python3 "$BASE_DIR/scripts/check_login.py" \
  --platforms xiaohongshu \
  --xhs-mode live \
  --timeout 10 \
  --xhs-command "/bin/sh -lc 'exit 0'" \
  > "$XHS_OK_JSON"
STATUS1=$?
set -e
[ "$STATUS1" -eq 0 ] || { echo "expected exit 0, got $STATUS1" >&2; exit 1; }
python3 - <<'PY' "$XHS_OK_JSON"
import json, sys
obj = json.load(open(sys.argv[1], 'r', encoding='utf-8'))
assert obj['all_logged_in'] is True
assert obj['results'][0]['status'] == 'logged_in'
print('xhs_ok_assert_ok')
PY

set +e
python3 "$BASE_DIR/scripts/check_login.py" \
  --platforms xiaohongshu \
  --xhs-mode live \
  --timeout 10 \
  --xhs-command "/bin/sh -lc 'echo NOT_LOGGED_IN; exit 1'" \
  > "$XHS_FAIL_JSON"
STATUS2=$?
set -e
[ "$STATUS2" -eq 1 ] || { echo "expected exit 1, got $STATUS2" >&2; exit 1; }
python3 - <<'PY' "$XHS_FAIL_JSON"
import json, sys
obj = json.load(open(sys.argv[1], 'r', encoding='utf-8'))
assert obj['has_not_logged_in'] is True
assert obj['results'][0]['status'] == 'not_logged_in'
print('xhs_fail_assert_ok')
PY

set +e
python3 "$BASE_DIR/scripts/check_login.py" --platforms douyin > "$DOUYIN_JSON"
STATUS3=$?
set -e
[ "$STATUS3" -eq 2 ] || { echo "expected exit 2, got $STATUS3" >&2; exit 1; }
python3 - <<'PY' "$DOUYIN_JSON"
import json, sys
obj = json.load(open(sys.argv[1], 'r', encoding='utf-8'))
assert obj['has_blocked_checks'] is True
assert obj['results'][0]['status'] == 'unsupported'
print('douyin_blocked_assert_ok')
PY

printf '\n✅ platform-login-helper smoke test passed\n'
printf 'Output directory: %s\n' "$OUT_DIR"
ls -1 "$OUT_DIR"
