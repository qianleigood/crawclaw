#!/bin/bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: prepare_grok_video_job.sh [options] [-- reference-file ...]

Prepare a Grok web video job workspace under:
  runtime/browser-jobs/grok-video-web/<job-id>/

Options:
  --job-id <id>             Explicit job id.
  --profile <name>          Browser profile. Default: grok-web.
  --prompt <text>           Save prompt text into state/request.json.
  --resolution <value>      Optional metadata (e.g. 480p, 720p).
  --duration <value>        Optional metadata (e.g. 6s, 10s).
  --aspect-ratio <value>    Optional metadata.
  --workspace <path>        Workspace root override.
  --help                    Show this help.

Any remaining paths after -- are copied into uploads/.
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DEFAULT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
WORKSPACE="$WORKSPACE_DEFAULT"
JOB_ID=""
PROFILE="grok-web"
PROMPT=""
RESOLUTION=""
DURATION=""
ASPECT_RATIO=""
REFERENCE_FILES=()
COPIED_FILES=()
LOG_SCRIPT=""

log_event() {
  local level="$1"
  local event="$2"
  local message="${3:-}"
  if [[ -n "$LOG_SCRIPT" && -n "${BROWSER_JOB_STATE_DIR:-}" ]]; then
    node "$LOG_SCRIPT" \
      --script prepare_grok_video_job \
      --state-dir "$BROWSER_JOB_STATE_DIR" \
      --job-id "${BROWSER_JOB_ID:-$JOB_ID}" \
      --job-dir "${BROWSER_JOB_DIR:-}" \
      --profile "${BROWSER_PROFILE:-$PROFILE}" \
      --level "$level" \
      --event "$event" \
      --message "$message" >/dev/null
  else
    printf '[%s] [%s] [prepare_grok_video_job] %s %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "${level^^}" "$event" "$message" >&2
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --job-id)
      JOB_ID="${2:-}"
      shift 2
      ;;
    --profile)
      PROFILE="${2:-}"
      shift 2
      ;;
    --prompt)
      PROMPT="${2:-}"
      shift 2
      ;;
    --resolution)
      RESOLUTION="${2:-}"
      shift 2
      ;;
    --duration)
      DURATION="${2:-}"
      shift 2
      ;;
    --aspect-ratio)
      ASPECT_RATIO="${2:-}"
      shift 2
      ;;
    --workspace)
      WORKSPACE="${2:-}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --)
      shift
      while [[ $# -gt 0 ]]; do
        REFERENCE_FILES+=("$1")
        shift
      done
      break
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

LOG_SCRIPT="$WORKSPACE/skills-optional/grok-video-web/scripts/grok_job_logger.js"
if [[ -z "$JOB_ID" ]]; then
  JOB_ID="grok-video-web-$(date -u +%Y%m%dT%H%M%SZ)-$RANDOM"
fi

BROWSER_JOB_ID="$JOB_ID"
BROWSER_PROFILE="$PROFILE"
BROWSER_JOB_DIR="$WORKSPACE/runtime/browser-jobs/grok-video-web/$BROWSER_JOB_ID"
BROWSER_JOB_STATE_DIR="$BROWSER_JOB_DIR/state"
BROWSER_JOB_UPLOADS_DIR="$BROWSER_JOB_DIR/uploads"
BROWSER_JOB_DOWNLOADS_DIR="$BROWSER_JOB_DIR/downloads"
BROWSER_JOB_EXPORTS_DIR="$BROWSER_JOB_DIR/exports"
BROWSER_JOB_MANIFEST_PATH="$BROWSER_JOB_DIR/manifest.json"

mkdir -p \
  "$BROWSER_JOB_DIR" \
  "$BROWSER_JOB_STATE_DIR" \
  "$BROWSER_JOB_UPLOADS_DIR" \
  "$BROWSER_JOB_DOWNLOADS_DIR" \
  "$BROWSER_JOB_EXPORTS_DIR"

export BROWSER_JOB_ID
export BROWSER_PROFILE
export BROWSER_JOB_DIR
export BROWSER_JOB_STATE_DIR
export BROWSER_JOB_UPLOADS_DIR
export BROWSER_JOB_DOWNLOADS_DIR
export BROWSER_JOB_EXPORTS_DIR
export BROWSER_JOB_MANIFEST_PATH

python3 - <<'PY'
import json
import os
from pathlib import Path

manifest_path = Path(os.environ["BROWSER_JOB_MANIFEST_PATH"])
manifest = {
    "skill": "grok-video-web",
    "jobId": os.environ["BROWSER_JOB_ID"],
    "profile": os.environ["BROWSER_PROFILE"],
    "jobDir": os.environ["BROWSER_JOB_DIR"],
    "stateDir": os.environ["BROWSER_JOB_STATE_DIR"],
    "uploadsDir": os.environ["BROWSER_JOB_UPLOADS_DIR"],
    "downloadsDir": os.environ["BROWSER_JOB_DOWNLOADS_DIR"],
    "exportsDir": os.environ["BROWSER_JOB_EXPORTS_DIR"],
}
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY
log_event info prepare.workspace_ready "jobId=${BROWSER_JOB_ID:-$JOB_ID} profile=${BROWSER_PROFILE:-$PROFILE} jobDir=${BROWSER_JOB_DIR:-}"

REQUEST_PATH="$BROWSER_JOB_STATE_DIR/request.json"
RESUME_SCRIPT="$WORKSPACE/skills-optional/grok-video-web/scripts/dev/grok_video_resume.js"

if [[ ! -f "$RESUME_SCRIPT" ]]; then
  echo "resume script not found: $RESUME_SCRIPT" >&2
  exit 2
fi
chmod +x "$RESUME_SCRIPT"

if [[ ${#REFERENCE_FILES[@]} -gt 0 ]]; then
  for file in "${REFERENCE_FILES[@]}"; do
    if [[ ! -f "$file" ]]; then
      echo "Reference file not found: $file" >&2
      exit 2
    fi
    dest="$BROWSER_JOB_UPLOADS_DIR/$(basename "$file")"
    cp "$file" "$dest"
    COPIED_FILES+=("$dest")
    log_event info prepare.reference_copied "source=$(basename "$file") dest=$dest"
  done
fi

export GROK_JOB_REQUEST_PATH="$REQUEST_PATH"
export GROK_JOB_PROMPT="$PROMPT"
export GROK_JOB_RESOLUTION="$RESOLUTION"
export GROK_JOB_DURATION="$DURATION"
export GROK_JOB_ASPECT_RATIO="$ASPECT_RATIO"
if [[ ${#COPIED_FILES[@]} -gt 0 ]]; then
  export GROK_JOB_REFERENCES_JSON="$(python3 - <<'PY' "${COPIED_FILES[@]}"
import json, sys
print(json.dumps(sys.argv[1:], ensure_ascii=False))
PY
)"
else
  export GROK_JOB_REFERENCES_JSON='[]'
fi

python3 - <<'PY'
import json
import os
from pathlib import Path

request_path = Path(os.environ["GROK_JOB_REQUEST_PATH"])
payload = {
    "skill": "grok-video-web",
    "jobId": os.environ["BROWSER_JOB_ID"],
    "profile": os.environ["BROWSER_PROFILE"],
    "prompt": os.environ["GROK_JOB_PROMPT"],
    "resolution": os.environ["GROK_JOB_RESOLUTION"],
    "duration": os.environ["GROK_JOB_DURATION"],
    "aspectRatio": os.environ["GROK_JOB_ASPECT_RATIO"],
    "references": json.loads(os.environ["GROK_JOB_REFERENCES_JSON"]),
}
request_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

manifest_path = Path(os.environ["BROWSER_JOB_MANIFEST_PATH"])
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
manifest["requestFile"] = str(request_path)
manifest["defaultDownloadPolicy"] = {
    "rawDownloadsDir": os.environ["BROWSER_JOB_DOWNLOADS_DIR"],
    "finalExportsDir": os.environ["BROWSER_JOB_EXPORTS_DIR"],
}
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

print(json.dumps({
    "skill": "grok-video-web",
    "jobId": os.environ["BROWSER_JOB_ID"],
    "profile": os.environ["BROWSER_PROFILE"],
    "jobDir": os.environ["BROWSER_JOB_DIR"],
    "uploadsDir": os.environ["BROWSER_JOB_UPLOADS_DIR"],
    "downloadsDir": os.environ["BROWSER_JOB_DOWNLOADS_DIR"],
    "exportsDir": os.environ["BROWSER_JOB_EXPORTS_DIR"],
    "stateDir": os.environ["BROWSER_JOB_STATE_DIR"],
    "requestFile": str(request_path),
}, ensure_ascii=False, indent=2))
PY

node "$RESUME_SCRIPT" init --state-dir "$BROWSER_JOB_STATE_DIR" >/dev/null
log_event info prepare.finished "request=$REQUEST_PATH references=${#COPIED_FILES[@]} uploadsDir=$BROWSER_JOB_UPLOADS_DIR"
