#!/usr/bin/env python3
"""Inspect job-based video analysis status."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from job_store import get_job_root, list_job_dirs, load_job, load_manifest, resolve_job_dir
from provider_health import breaker_status

DISPATCHER_PID_FILE = "dispatcher.pid"


def read_dispatcher_pid(jobs_root: Path) -> int | None:
    path = jobs_root / DISPATCHER_PID_FILE
    if not path.exists():
        return None
    try:
        return int(path.read_text(encoding="utf-8").strip())
    except Exception:
        return None


def is_pid_alive(pid: int | None) -> bool:
    if not pid:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def summarize_manifest(job_dir: Path) -> dict:
    manifest = load_manifest(job_dir)
    failed_final = sum(1 for item in manifest if item.get('status') == 'failed_final')
    next_retry = sorted(
        [item.get('next_attempt_at') for item in manifest if item.get('status') == 'retry_wait' and item.get('next_attempt_at')],
    )
    return {
        'failed_final': failed_final,
        'next_retry_at': next_retry[0] if next_retry else None,
    }


def print_job(job_dir: Path, output_dir: Path | None = None) -> None:
    job = load_job(job_dir)
    manifest_summary = summarize_manifest(job_dir)
    jobs_root = get_job_root(output_dir)
    dispatcher_pid = read_dispatcher_pid(jobs_root)
    health = breaker_status(jobs_root.parent)
    print(f"job_id: {job.get('job_id', job_dir.name)}")
    print(f"status: {job.get('status')}")
    print(f"stage: {job.get('stage')}")
    print(f"dispatcher: {'alive' if is_pid_alive(dispatcher_pid) else 'stopped'}")
    print(f"provider_breaker: {'open' if health.get('open') else 'closed'}")
    if health.get('open_until'):
        print(f"provider_open_until: {health.get('open_until')}")
    if health.get('last_error'):
        print(f"provider_last_error: {health.get('last_error')}")
    print(f"video_path: {job.get('video_path') or '-'}")
    print(f"total: {job.get('total_scenes', 0)}")
    print(f"success: {job.get('success', 0)}")
    print(f"failed: {job.get('failed', 0)}")
    print(f"skipped: {job.get('skipped', 0)}")
    print(f"pending: {job.get('pending', 0)}")
    print(f"running: {job.get('running', 0)}")
    print(f"retry_wait: {job.get('retry_wait', 0)}")
    print(f"failed_final: {manifest_summary.get('failed_final', 0)}")
    if manifest_summary.get('next_retry_at'):
        print(f"next_retry_at: {manifest_summary.get('next_retry_at')}")
    print(f"completeness: {job.get('completeness', 0.0) * 100:.1f}%")
    print(f"report: {job.get('report_path') or '-'}")
    print(f"feishu_notify: {'enabled' if job.get('feishu_send_enabled') else 'disabled'}")
    if job.get('feishu_receive_id'):
        print(f"feishu_receive: {job.get('feishu_receive_id_type', 'open_id')}={job.get('feishu_receive_id')}")
    print(f"feishu_sent: {job.get('feishu_sent')}")
    if job.get('feishu_sent_at'):
        print(f"feishu_sent_at: {job.get('feishu_sent_at')}")
    if job.get('feishu_message_id'):
        print(f"feishu_message_id: {job.get('feishu_message_id')}")
    if job.get('feishu_last_error'):
        print(f"feishu_last_error: {job.get('feishu_last_error')}")
    print(f"last_error: {job.get('last_error') or '-'}")
    print(f"updated_at: {job.get('updated_at')}")


def list_jobs(limit: int, output_dir: Path | None = None) -> None:
    for job_dir in list_job_dirs(output_dir)[:limit]:
        job = load_job(job_dir)
        manifest_summary = summarize_manifest(job_dir)
        next_retry = manifest_summary.get('next_retry_at') or '-'
        print(
            f"{job_dir.name}\t{job.get('status')}\t"
            f"ok={job.get('success', 0)}/{job.get('total_scenes', 0)}\t"
            f"pending={job.get('pending', 0)}\t"
            f"retry={job.get('retry_wait', 0)}\t"
            f"failed_final={manifest_summary.get('failed_final', 0)}\t"
            f"next={next_retry}\t"
            f"{job.get('updated_at')}"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="查看任务状态")
    parser.add_argument("job_id", nargs="?", help="任务 ID")
    parser.add_argument("--list", action="store_true", help="列出最近任务")
    parser.add_argument("--limit", type=int, default=10, help="列表数量")
    parser.add_argument("-o", "--output", default=None, help="输出目录")
    args = parser.parse_args()

    output_dir = Path(args.output).resolve() if args.output else None

    if args.list:
        list_jobs(args.limit, output_dir)
        return 0

    if not args.job_id:
        parser.error("请提供 job_id 或使用 --list")

    print_job(resolve_job_dir(args.job_id, output_dir), output_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
