#!/usr/bin/env python3
"""Legacy spawn entrypoint kept for compatibility.

Deprecated: submit to the job system instead of running a single 30-minute process.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from submit_job import main as submit_main


def main() -> int:
    parser = argparse.ArgumentParser(description="兼容旧版 spawn 入口，内部改走 job submit")
    parser.add_argument("url", help="视频链接或路径")
    parser.add_argument("--prompt", "-p", help="分析要求")
    parser.add_argument("--user", help="保留兼容参数，不再使用")
    parser.add_argument("-o", "--output", default="./output", help="输出目录")
    args = parser.parse_args()

    print("⚠️ spawn_analysis.py 已废弃，已自动改走 submit + dispatcher")
    argv = [sys.argv[0], args.url, "-o", args.output]
    if args.prompt:
        argv.extend(["-q", args.prompt])

    old_argv = sys.argv
    try:
        sys.argv = argv
        return submit_main()
    finally:
        sys.argv = old_argv


if __name__ == "__main__":
    raise SystemExit(main())
