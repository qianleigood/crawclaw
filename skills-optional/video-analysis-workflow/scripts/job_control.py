#!/usr/bin/env python3
"""Pause/resume/cancel/retry-failed controls for job-based video analysis."""

from __future__ import annotations

import argparse
from pathlib import Path

from dispatcher import spawn_dispatcher
from job_store import load_job, load_manifest, recover_stale_leases, resolve_job_dir, save_job, save_manifest, update_job_counts

PAUSABLE_STATUSES = {"queued", "preparing", "ready", "analyzing", "paused_provider_unhealthy"}
RESUMABLE_STATUSES = {"paused", "paused_provider_unhealthy"}
CANCELLABLE_STATUSES = {"queued", "preparing", "ready", "analyzing", "paused", "paused_provider_unhealthy"}


def cmd_pause(job_dir: Path) -> None:
    job = load_job(job_dir)
    if job.get("status") in PAUSABLE_STATUSES:
        job["status"] = "paused"
        job["stage"] = "paused_by_user"
        save_job(job_dir, job)
    print(f"✅ 已暂停: {job_dir.name}")


def cmd_resume(job_dir: Path, output_dir: Path | None) -> None:
    job = load_job(job_dir)
    manifest = load_manifest(job_dir)
    recovered = recover_stale_leases(job_dir)
    if job.get("status") in RESUMABLE_STATUSES:
        if not manifest:
            job["status"] = "queued"
            job["stage"] = "queued_for_prepare"
        else:
            job["status"] = "ready"
            job["stage"] = "scene_dispatch"
        save_job(job_dir, job)
        update_job_counts(job_dir)
        if output_dir:
            spawn_dispatcher(output_dir)
    suffix = f"，回收 {recovered} 个过期 lease" if recovered else ""
    print(f"✅ 已恢复: {job_dir.name}{suffix}")


def cmd_cancel(job_dir: Path) -> None:
    job = load_job(job_dir)
    manifest = load_manifest(job_dir)
    if job.get("status") in CANCELLABLE_STATUSES:
        for item in manifest:
            if item.get("status") in {"pending", "retry_wait", "leased", "running"}:
                item["status"] = "failed_final"
                item["last_error"] = "cancelled by user"
        save_manifest(job_dir, manifest)
        job["status"] = "failed"
        job["stage"] = "cancelled_by_user"
        job["last_error"] = "cancelled by user"
        save_job(job_dir, job)
        update_job_counts(job_dir)
    print(f"✅ 已取消: {job_dir.name}")


def cmd_retry_failed(job_dir: Path, output_dir: Path | None) -> None:
    manifest = load_manifest(job_dir)
    touched = 0
    for item in manifest:
        if item.get("status") in {"failed_final", "retry_wait", "error", "failed", "upload_failed", "exception"}:
            item["status"] = "pending"
            item["next_attempt_at"] = None
            item["lease_owner"] = None
            item["lease_expires_at"] = None
            item["last_error"] = None
            touched += 1
    save_manifest(job_dir, manifest)

    job = load_job(job_dir)
    job["status"] = "ready"
    job["stage"] = "scene_dispatch"
    job["last_error"] = None
    save_job(job_dir, job)
    update_job_counts(job_dir)
    if output_dir:
        spawn_dispatcher(output_dir)
    print(f"✅ 已重置失败片段: {job_dir.name} ({touched} 项)")


def main() -> int:
    parser = argparse.ArgumentParser(description="任务控制")
    parser.add_argument("action", choices=["pause", "resume", "cancel", "retry-failed"], help="控制动作")
    parser.add_argument("job_id", help="任务 ID")
    parser.add_argument("-o", "--output", default=None, help="输出目录")
    args = parser.parse_args()

    output_dir = Path(args.output).resolve() if args.output else None
    job_dir = resolve_job_dir(args.job_id, output_dir)

    if args.action == "pause":
        cmd_pause(job_dir)
    elif args.action == "resume":
        cmd_resume(job_dir, output_dir)
    elif args.action == "cancel":
        cmd_cancel(job_dir)
    elif args.action == "retry-failed":
        cmd_retry_failed(job_dir, output_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
