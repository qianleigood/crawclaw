#!/usr/bin/env python3
"""Run a single scene analysis in an isolated subprocess."""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import sys
from pathlib import Path

from job_store import load_job, load_manifest, resolve_job_dir
from workflow_core import analyze_scene


def main() -> int:
    parser = argparse.ArgumentParser(description="单场景分析 worker")
    parser.add_argument("job_id", help="任务 ID 或任务目录")
    parser.add_argument("scene_idx", type=int, help="场景索引")
    args = parser.parse_args()

    job_dir = resolve_job_dir(args.job_id)
    job = load_job(job_dir)
    manifest = load_manifest(job_dir)

    item = next((x for x in manifest if x.get("idx") == args.scene_idx), None)
    if item is None:
        raise SystemExit(f"未找到 scene idx={args.scene_idx}")

    captured = io.StringIO()
    with contextlib.redirect_stdout(captured):
        result = analyze_scene(
            item["clip_path"],
            item["idx"],
            len(manifest),
            item["scene"],
            job.get("question"),
        )

    logs = captured.getvalue()
    if logs:
        sys.stderr.write(logs)

    json.dump(result, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
