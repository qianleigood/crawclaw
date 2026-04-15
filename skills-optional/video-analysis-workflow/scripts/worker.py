#!/usr/bin/env python3
"""Legacy worker entrypoint kept for compatibility.

Deprecated: use dispatcher.py + scene_worker.py instead.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from dispatcher import run_dispatcher
from job_store import resolve_job_dir


def main() -> int:
    parser = argparse.ArgumentParser(description="兼容旧版 worker 入口，内部转到 dispatcher")
    parser.add_argument("job_id", nargs="?", help="旧参数：任务 ID（将自动解析输出目录）")
    args = parser.parse_args()

    if args.job_id:
        job_dir = resolve_job_dir(args.job_id)
        output_dir = job_dir.parent.parent
        print("⚠️ worker.py 已废弃，已自动切换到 dispatcher")
        return run_dispatcher(output_dir)

    print("⚠️ worker.py 已废弃，请改用 scripts/dispatcher.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
