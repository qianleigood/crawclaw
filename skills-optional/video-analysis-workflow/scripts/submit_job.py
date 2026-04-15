#!/usr/bin/env python3
"""Submit a job quickly, then let the global dispatcher prepare and analyze it."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent

from dispatcher import spawn_dispatcher
from job_store import create_job_dir, get_default_output_dir, init_job, save_job
from workflow_core import get_workflow_missing_dependencies


def main() -> int:
    parser = argparse.ArgumentParser(description="Submit a video analysis job")
    parser.add_argument("video", help="输入视频路径或支持的分享链接")
    parser.add_argument("-o", "--output", default=None, help="输出目录（默认使用技能目录下 output/）")
    parser.add_argument("-q", "--question", help="自定义分析问题")
    parser.add_argument("--send-feishu", action="store_true", help="任务完成后自动通过飞书发送报告")
    parser.add_argument("--feishu-open-id", default=os.environ.get("CRAWCLAW_FEISHU_OPEN_ID") or os.environ.get("FEISHU_RECEIVE_ID"), help="飞书接收人 open_id")
    parser.add_argument("--feishu-receive-id-type", default="open_id", help="飞书接收人 ID 类型")
    args = parser.parse_args()

    output_dir = Path(args.output).resolve() if args.output else get_default_output_dir()
    output_dir.mkdir(parents=True, exist_ok=True)

    missing = get_workflow_missing_dependencies(input_value=args.video, feishu_send_enabled=bool(args.send_feishu or args.feishu_open_id))
    if missing:
        print("❌ 提交前预检失败：检测到缺失依赖/路径错误")
        for item in missing:
            print(f"- {item}")
        return 2

    feishu_receive_id = args.feishu_open_id
    feishu_send_enabled = bool(args.send_feishu or feishu_receive_id)

    job_dir = create_job_dir(output_dir, prefix="video")
    job = init_job(
        job_dir,
        input_value=args.video,
        question=args.question,
        feishu_send_enabled=feishu_send_enabled,
        feishu_receive_id=feishu_receive_id,
        feishu_receive_id_type=args.feishu_receive_id_type,
    )
    job["status"] = "queued"
    job["stage"] = "queued_for_prepare"
    save_job(job_dir, job)

    dispatcher_started = spawn_dispatcher(output_dir)

    print("✅ 任务已提交")
    print(f"job_id: {job_dir.name}")
    print(f"status: {job['status']}")
    print(f"stage: {job['stage']}")
    print(f"dispatcher: {'started' if dispatcher_started else 'already_running'}")
    if feishu_send_enabled:
        print(f"feishu_notify: enabled ({args.feishu_receive_id_type}={feishu_receive_id or '-'})")
    else:
        print("feishu_notify: disabled")
    print(f"job_dir: {job_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
