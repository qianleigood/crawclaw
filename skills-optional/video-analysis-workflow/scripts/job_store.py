#!/usr/bin/env python3
"""Job storage helpers for job-based video analysis."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

JOBS_DIRNAME = "jobs"
JOB_FILE = "job.json"
MANIFEST_FILE = "manifest.json"
RESULTS_DIR = "results"
REPORT_DIR = "report"
LOGS_DIR = "logs"
SCENES_DIR = "scenes"
DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent.parent / "output"
TERMINAL_SCENE_STATUSES = {"success", "failed_final", "skipped"}
RETRYABLE_SCENE_STATUSES = {"pending", "retry_wait"}
RUNNING_SCENE_STATUSES = {"leased", "running"}
FAILED_SCENE_STATUSES = {"failed", "error", "exception", "upload_failed", "failed_final"}


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except Exception:
        return None


def get_default_output_dir() -> Path:
    DEFAULT_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    return DEFAULT_OUTPUT_DIR


def ensure_job_root(output_dir: Path | None = None) -> Path:
    root = (output_dir or get_default_output_dir()) / JOBS_DIRNAME
    root.mkdir(parents=True, exist_ok=True)
    return root


def get_job_root(output_dir: Path | None = None) -> Path:
    return ensure_job_root(output_dir)


def make_job_id(prefix: str = "job") -> str:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"{prefix}_{ts}_{uuid4().hex[:6]}"


def create_job_dir(output_dir: Path, prefix: str = "job") -> Path:
    root = ensure_job_root(output_dir)
    job_dir = root / make_job_id(prefix)
    job_dir.mkdir(parents=True, exist_ok=False)
    (job_dir / RESULTS_DIR).mkdir(exist_ok=True)
    (job_dir / REPORT_DIR).mkdir(exist_ok=True)
    (job_dir / LOGS_DIR).mkdir(exist_ok=True)
    (job_dir / SCENES_DIR).mkdir(exist_ok=True)
    return job_dir


def list_job_dirs(output_dir: Path | None = None) -> list[Path]:
    root = get_job_root(output_dir)
    job_dirs = [p for p in root.iterdir() if p.is_dir() and (p / JOB_FILE).exists()]
    job_dirs.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return job_dirs


def resolve_job_dir(job_id: str, output_dir: Path | None = None) -> Path:
    candidate = Path(job_id)
    if candidate.is_dir() and (candidate / JOB_FILE).exists():
        return candidate.resolve()

    direct = get_job_root(output_dir) / job_id
    if direct.is_dir() and (direct / JOB_FILE).exists():
        return direct.resolve()

    matches = [p for p in list_job_dirs(output_dir) if p.name == job_id]
    if matches:
        return matches[0]

    raise FileNotFoundError(f"未找到任务: {job_id}")


def job_file(job_dir: Path) -> Path:
    return job_dir / JOB_FILE


def manifest_file(job_dir: Path) -> Path:
    return job_dir / MANIFEST_FILE


def result_file(job_dir: Path, idx: int) -> Path:
    return job_dir / RESULTS_DIR / f"{idx:03d}.json"


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _read_json(path: Path, default: Any):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def init_job(
    job_dir: Path,
    *,
    input_value: str,
    question: str | None = None,
    feishu_send_enabled: bool = False,
    feishu_receive_id: str | None = None,
    feishu_receive_id_type: str = "open_id",
) -> dict:
    job = {
        "job_id": job_dir.name,
        "input": input_value,
        "video_path": None,
        "question": question,
        "status": "queued",
        "stage": "created",
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "total_scenes": 0,
        "success": 0,
        "failed": 0,
        "skipped": 0,
        "pending": 0,
        "running": 0,
        "retry_wait": 0,
        "report_path": None,
        "completeness": 0.0,
        "last_error": None,
        "feishu_send_enabled": feishu_send_enabled,
        "feishu_receive_id": feishu_receive_id,
        "feishu_receive_id_type": feishu_receive_id_type,
        "feishu_sent": False,
        "feishu_sent_at": None,
        "feishu_sent_status": None,
        "feishu_message_id": None,
        "feishu_summary_message_id": None,
        "feishu_last_error": None,
        "version": "3.0",
    }
    save_job(job_dir, job)
    save_manifest(job_dir, [])
    return job


def load_job(job_dir: Path) -> dict:
    return _read_json(job_file(job_dir), {})


def save_job(job_dir: Path, job: dict) -> None:
    job["updated_at"] = now_iso()
    _write_json(job_file(job_dir), job)


def load_manifest(job_dir: Path) -> list[dict]:
    return _read_json(manifest_file(job_dir), [])


def save_manifest(job_dir: Path, manifest: list[dict]) -> None:
    _write_json(manifest_file(job_dir), manifest)


def build_manifest(cut_results: list[dict], *, max_attempts: int = 3) -> list[dict]:
    manifest = []
    for item in cut_results:
        manifest.append(
            {
                "idx": item["idx"],
                "clip_path": item["path"],
                "scene": item["scene"],
                "status": "pending",
                "attempt_count": 0,
                "max_attempts": max_attempts,
                "next_attempt_at": None,
                "lease_owner": None,
                "lease_expires_at": None,
                "started_at": None,
                "finished_at": None,
                "result_file": None,
                "last_error": None,
                "updated_at": now_iso(),
            }
        )
    return manifest


def update_manifest_item(job_dir: Path, idx: int, **fields) -> dict:
    manifest = load_manifest(job_dir)
    for item in manifest:
        if item.get("idx") == idx:
            item.update(fields)
            item["updated_at"] = now_iso()
            save_manifest(job_dir, manifest)
            return item
    raise KeyError(f"manifest 中不存在 idx={idx}")


def write_scene_result(job_dir: Path, idx: int, result: dict) -> Path:
    path = result_file(job_dir, idx)
    _write_json(path, result)
    return path


def load_scene_result(job_dir: Path, idx: int) -> dict | None:
    return _read_json(result_file(job_dir, idx), None)


def recover_stale_leases(job_dir: Path, *, now: datetime | None = None) -> int:
    now = now or datetime.now()
    manifest = load_manifest(job_dir)
    changed = 0
    for item in manifest:
        status = item.get("status")
        lease_expires_at = parse_iso(item.get("lease_expires_at"))
        lease_owner = item.get("lease_owner")
        if status in RUNNING_SCENE_STATUSES and lease_owner:
            if lease_expires_at is None or lease_expires_at <= now:
                item["status"] = "pending" if item.get("attempt_count", 0) == 0 else "retry_wait"
                item["lease_owner"] = None
                item["lease_expires_at"] = None
                item["updated_at"] = now_iso()
                changed += 1
    if changed:
        save_manifest(job_dir, manifest)
    return changed


def runnable_scene_items(job_dir: Path, *, now: datetime | None = None) -> list[dict]:
    now = now or datetime.now()
    recover_stale_leases(job_dir, now=now)
    runnable = []
    for item in load_manifest(job_dir):
        status = item.get("status", "pending")
        if status not in RETRYABLE_SCENE_STATUSES:
            continue
        next_attempt_at = parse_iso(item.get("next_attempt_at"))
        if next_attempt_at and next_attempt_at > now:
            continue
        lease_expires_at = parse_iso(item.get("lease_expires_at"))
        if item.get("lease_owner") and lease_expires_at and lease_expires_at > now:
            continue
        runnable.append(item)
    runnable.sort(key=lambda x: x.get("idx", 0))
    return runnable


def next_retry_at(attempt_count: int, *, now: datetime | None = None) -> str:
    now = now or datetime.now()
    backoff_seconds = [300, 900, 3600]
    index = min(max(attempt_count - 1, 0), len(backoff_seconds) - 1)
    return (now.timestamp() + backoff_seconds[index]).__round__()


def next_retry_iso(attempt_count: int, *, now: datetime | None = None) -> str:
    from datetime import timedelta

    now = now or datetime.now()
    backoff_seconds = [300, 900, 3600]
    index = min(max(attempt_count - 1, 0), len(backoff_seconds) - 1)
    return (now + timedelta(seconds=backoff_seconds[index])).isoformat(timespec="seconds")


def update_job_counts(job_dir: Path) -> dict:
    job = load_job(job_dir)
    manifest = load_manifest(job_dir)

    success = sum(1 for item in manifest if item.get("status") == "success")
    skipped = sum(1 for item in manifest if item.get("status") == "skipped")
    failed = sum(1 for item in manifest if item.get("status") in FAILED_SCENE_STATUSES)
    pending = sum(1 for item in manifest if item.get("status") == "pending")
    running = sum(1 for item in manifest if item.get("status") in RUNNING_SCENE_STATUSES)
    retry_wait = sum(1 for item in manifest if item.get("status") == "retry_wait")
    total = len(manifest)

    terminal = success + skipped + sum(1 for item in manifest if item.get("status") == "failed_final")
    completeness = (success / total) if total else 0.0

    job.update(
        {
            "total_scenes": total,
            "success": success,
            "failed": failed,
            "skipped": skipped,
            "pending": pending,
            "running": running,
            "retry_wait": retry_wait,
            "completeness": completeness,
        }
    )

    if total:
        if job.get("stage") == "cancelled_by_user":
            job["status"] = "failed"
        elif job.get("status") in {"paused", "paused_provider_unhealthy"}:
            pass
        elif running > 0:
            job["status"] = "analyzing"
        elif pending > 0 or retry_wait > 0:
            if job.get("status") not in {"preparing", "failed"}:
                job["status"] = "ready"
        elif terminal >= total:
            job["status"] = "completed" if completeness >= 0.95 else "partial_done"

    save_job(job_dir, job)
    return job
