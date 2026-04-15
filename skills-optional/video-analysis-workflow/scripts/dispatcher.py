#!/usr/bin/env python3
"""Global dispatcher for queued video scene analysis jobs."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path

from job_store import (
    build_manifest,
    list_job_dirs,
    load_job,
    load_manifest,
    now_iso,
    recover_stale_leases,
    resolve_job_dir,
    runnable_scene_items,
    save_job,
    update_job_counts,
    update_manifest_item,
    write_scene_result,
    next_retry_iso,
)
from feishu_notify import send_job_report, should_send_job
from provider_health import breaker_status, close_breaker_if_expired, is_breaker_open, record_scene_result
from workflow_core import (
    SUCCESS_RATE_THRESHOLD,
    check_analysis_completeness,
    create_report,
    cut_scenes,
    detect_scenes,
    ensure_workflow_dependencies,
    get_video_id,
    preprocess_video,
    resolve_input_video,
    set_logger,
    setup_logging,
)

SCRIPT_DIR = Path(__file__).resolve().parent
DISPATCHER_PID_FILE = "dispatcher.pid"
LEASE_SECONDS = 15 * 60
SCENE_HARD_TIMEOUT = 8 * 60
IDLE_EXIT_SECONDS = 60
POLL_SECONDS = 3
PARTIAL_REPORT_THRESHOLD = 0.80
ACTIVE_JOB_STATUSES = {"queued", "preparing", "ready", "analyzing"}
PAUSED_JOB_STATUSES = {"paused", "paused_provider_unhealthy"}


def pid_file(jobs_root: Path) -> Path:
    return jobs_root / DISPATCHER_PID_FILE


def is_pid_alive(pid: int | None) -> bool:
    if not pid:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def read_dispatcher_pid(jobs_root: Path) -> int | None:
    path = pid_file(jobs_root)
    if not path.exists():
        return None
    try:
        return int(path.read_text(encoding="utf-8").strip())
    except Exception:
        return None


def acquire_dispatcher_lock(jobs_root: Path) -> bool:
    path = pid_file(jobs_root)
    existing = read_dispatcher_pid(jobs_root)
    if existing and is_pid_alive(existing):
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(str(os.getpid()), encoding="utf-8")
    return True


def release_dispatcher_lock(jobs_root: Path) -> None:
    path = pid_file(jobs_root)
    if path.exists():
        try:
            path.unlink()
        except Exception:
            pass


def resolve_input_with_retry(input_value: str, job_dir: Path, *, attempts: int = 2, delay_seconds: int = 2) -> str:
    last_error = None
    for attempt in range(1, attempts + 1):
        try:
            return resolve_input_video(input_value, job_dir)
        except Exception as exc:
            last_error = exc
            if attempt < attempts:
                time.sleep(delay_seconds)
    raise last_error


def prepare_job(job_dir: Path) -> dict:
    job = load_job(job_dir)
    if job.get("status") not in {"queued", "preparing"}:
        return job

    video_id = get_video_id(job.get("input") or job_dir.name)
    logger = setup_logging(job_dir, video_id)
    set_logger(logger)

    try:
        job["status"] = "preparing"
        job["stage"] = "preflight_dependencies"
        save_job(job_dir, job)

        ensure_workflow_dependencies(input_value=job.get("input"), feishu_send_enabled=bool(job.get("feishu_send_enabled")))

        job["stage"] = "resolve_input"
        save_job(job_dir, job)

        scenes_dir = job_dir / "scenes"
        original_video = resolve_input_with_retry(job["input"], job_dir)
        job["video_path"] = original_video
        video_id = get_video_id(job["input"])

        logger = setup_logging(job_dir, video_id)
        set_logger(logger)

        job["stage"] = "preprocess"
        save_job(job_dir, job)
        preprocessed_video = preprocess_video(original_video, scenes_dir, video_id)

        job["stage"] = "detect_scenes"
        save_job(job_dir, job)
        scenes = detect_scenes(preprocessed_video, scenes_dir, video_id)
        if not scenes:
            job["status"] = "failed"
            job["last_error"] = "scene detection returned no scenes"
            save_job(job_dir, job)
            return job

        job["stage"] = "cut_scenes"
        save_job(job_dir, job)
        cut_results = cut_scenes(original_video, scenes, scenes_dir, video_id)
        if not cut_results:
            job["status"] = "failed"
            job["last_error"] = "scene cutting returned no clips"
            save_job(job_dir, job)
            return job

        manifest = build_manifest(cut_results)
        from job_store import save_manifest

        save_manifest(job_dir, manifest)

        job["status"] = "ready"
        job["stage"] = "scene_dispatch"
        job["total_scenes"] = len(manifest)
        job["pending"] = len(manifest)
        job["last_error"] = None
        save_job(job_dir, job)
        return job
    except Exception as exc:
        job = load_job(job_dir)
        job["status"] = "failed"
        job["last_error"] = str(exc)
        save_job(job_dir, job)
        logger.exception(f"❌ prepare_job 失败: {exc}")
        trace_path = job_dir / "logs" / "prepare_error.log"
        trace_path.parent.mkdir(parents=True, exist_ok=True)
        trace_path.write_text(traceback.format_exc(), encoding="utf-8")
        return job


def find_next_scene_job(jobs_root: Path) -> tuple[Path, dict] | None:
    now = datetime.now()
    for job_dir in list_job_dirs(jobs_root.parent):
        job = load_job(job_dir)
        if job.get("status") in {"failed", "completed", "partial_done", "paused", "paused_provider_unhealthy"}:
            continue

        if job.get("status") in {"queued", "preparing"}:
            job = prepare_job(job_dir)
            if job.get("status") == "failed":
                continue

        for item in runnable_scene_items(job_dir, now=now):
            return job_dir, item
    return None


def maybe_send_feishu_report(job_dir: Path) -> None:
    job = load_job(job_dir)
    if not should_send_job(job):
        return
    try:
        updates = send_job_report(job)
        job.update(updates)
        save_job(job_dir, job)
    except Exception as exc:
        job["feishu_last_error"] = str(exc)
        save_job(job_dir, job)


def finalize_job(job_dir: Path) -> None:
    job = update_job_counts(job_dir)
    manifest = load_manifest(job_dir)

    if job.get("status") in PAUSED_JOB_STATUSES:
        save_job(job_dir, job)
        return

    active_statuses = {item.get("status") for item in manifest}
    if active_statuses & {"pending", "retry_wait", "leased", "running"}:
        job["stage"] = "scene_dispatch"
        save_job(job_dir, job)
        return

    analyses = []
    for item in sorted(manifest, key=lambda x: x["idx"]):
        result_path = job_dir / (item.get("result_file") or "")
        if result_path.exists():
            analyses.append(json.loads(result_path.read_text(encoding="utf-8")))
        else:
            analyses.append(
                {
                    "idx": item["idx"],
                    "path": item["clip_path"],
                    "scene": item["scene"],
                    "analysis": f"[状态: {item.get('status')}]",
                    "status": item.get("status"),
                    "size_mb": item.get("size_mb", 0),
                }
            )

    completeness = check_analysis_completeness(analyses)
    if analyses and completeness["success_rate"] >= PARTIAL_REPORT_THRESHOLD:
        report_dir = job_dir / "report"
        report_dir.mkdir(parents=True, exist_ok=True)
        report_path = create_report(job["video_path"], [m["scene"] for m in manifest], analyses, report_dir, job.get("question"))
        job["report_path"] = str(report_path)

    job["status"] = "completed" if completeness["success_rate"] >= SUCCESS_RATE_THRESHOLD else "partial_done"
    job["stage"] = "done"
    job["last_error"] = None if job["status"] in {"completed", "partial_done"} else job.get("last_error")
    save_job(job_dir, job)
    maybe_send_feishu_report(job_dir)


def run_scene(job_dir: Path, item: dict, output_dir: Path) -> None:
    job = load_job(job_dir)
    if job.get("status") in PAUSED_JOB_STATUSES:
        return

    update_manifest_item(
        job_dir,
        item["idx"],
        status="leased",
        lease_owner=f"dispatcher:{os.getpid()}",
        lease_expires_at=datetime.fromtimestamp(time.time() + LEASE_SECONDS).isoformat(timespec="seconds"),
    )

    update_manifest_item(job_dir, item["idx"], status="running", started_at=now_iso())
    job["status"] = "analyzing"
    job["stage"] = "scene_running"
    save_job(job_dir, job)
    update_job_counts(job_dir)

    cmd = [sys.executable, str(SCRIPT_DIR / "scene_worker.py"), str(job_dir), str(item["idx"])]
    result_status = "failed_final"
    error_message = None
    payload = None
    attempt_count = int(item.get("attempt_count", 0)) + 1
    max_attempts = int(item.get("max_attempts", 3))

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=SCENE_HARD_TIMEOUT, cwd=str(SCRIPT_DIR.parent))
        stdout = (proc.stdout or "").strip()
        stderr = (proc.stderr or "").strip()
        if proc.returncode == 0 and stdout:
            payload = json.loads(stdout)
            payload["attempt_count"] = attempt_count
            result_path = write_scene_result(job_dir, item["idx"], payload)
            scene_status = payload.get("status", "failed")
            record_scene_result(output_dir, scene_status, None if scene_status in {"success", "skipped"} else payload.get("analysis"))
            terminal_status = scene_status
            extra = {
                "result_file": str(result_path.relative_to(job_dir)),
                "last_error": None if scene_status == "success" else payload.get("analysis"),
                "finished_at": now_iso(),
                "attempt_count": attempt_count,
                "lease_owner": None,
                "lease_expires_at": None,
            }
            if scene_status == "success":
                terminal_status = "success"
            elif scene_status == "skipped":
                terminal_status = "skipped"
            else:
                if attempt_count < max_attempts:
                    terminal_status = "retry_wait"
                    extra["next_attempt_at"] = next_retry_iso(attempt_count)
                else:
                    terminal_status = "failed_final"
            update_manifest_item(job_dir, item["idx"], status=terminal_status, **extra)
        else:
            error_message = stderr or stdout or f"scene_worker exited with code {proc.returncode}"
            raise RuntimeError(error_message)
    except subprocess.TimeoutExpired:
        error_message = f"scene worker timeout after {SCENE_HARD_TIMEOUT}s"
    except Exception as exc:
        error_message = str(exc)

    if error_message is not None:
        record_scene_result(output_dir, "failed", error_message)
        if attempt_count < max_attempts:
            status = "retry_wait"
            next_attempt_at = next_retry_iso(attempt_count)
        else:
            status = "failed_final"
            next_attempt_at = None
        payload = {
            "idx": item["idx"],
            "path": item["clip_path"],
            "scene": item["scene"],
            "analysis": f"[分析失败: {error_message}]",
            "status": status,
            "attempt_count": attempt_count,
            "finished_at": now_iso(),
        }
        result_path = write_scene_result(job_dir, item["idx"], payload)
        update_manifest_item(
            job_dir,
            item["idx"],
            status=status,
            result_file=str(result_path.relative_to(job_dir)),
            last_error=error_message,
            finished_at=now_iso(),
            attempt_count=attempt_count,
            lease_owner=None,
            lease_expires_at=None,
            next_attempt_at=next_attempt_at,
        )

    update_job_counts(job_dir)
    finalize_job(job_dir)


def has_active_jobs(output_dir: Path) -> bool:
    for job_dir in list_job_dirs(output_dir):
        recover_stale_leases(job_dir)
        update_job_counts(job_dir)
        job = load_job(job_dir)
        if job.get("status") in ACTIVE_JOB_STATUSES:
            return True
        if job.get("retry_wait", 0) > 0:
            return True
    return False


def apply_provider_pause(output_dir: Path) -> None:
    status = breaker_status(output_dir)
    if not status["open"]:
        return
    for job_dir in list_job_dirs(output_dir):
        job = load_job(job_dir)
        if job.get("status") in {"ready", "analyzing"}:
            job["status"] = "paused_provider_unhealthy"
            job["stage"] = "provider_circuit_breaker_open"
            job["last_error"] = status.get("last_error")
            save_job(job_dir, job)


def resume_provider_paused_jobs(output_dir: Path) -> None:
    status = breaker_status(output_dir)
    if status["open"]:
        return
    for job_dir in list_job_dirs(output_dir):
        job = load_job(job_dir)
        if job.get("status") == "paused_provider_unhealthy":
            job["status"] = "ready"
            job["stage"] = "scene_dispatch"
            job["last_error"] = None
            save_job(job_dir, job)


def run_dispatcher(output_dir: Path) -> int:
    jobs_root = output_dir / "jobs"
    jobs_root.mkdir(parents=True, exist_ok=True)

    if not acquire_dispatcher_lock(jobs_root):
        print("⏩ dispatcher 已在运行")
        return 0

    idle_since = time.time()
    try:
        while True:
            close_breaker_if_expired(output_dir)
            resume_provider_paused_jobs(output_dir)

            if is_breaker_open(output_dir):
                apply_provider_pause(output_dir)
                idle_since = time.time()
                time.sleep(POLL_SECONDS)
                continue

            found = find_next_scene_job(jobs_root)
            if found is None:
                if has_active_jobs(output_dir):
                    idle_since = time.time()
                    time.sleep(POLL_SECONDS)
                    continue
                if time.time() - idle_since >= IDLE_EXIT_SECONDS:
                    return 0
                time.sleep(POLL_SECONDS)
                continue

            idle_since = time.time()
            job_dir, item = found
            run_scene(job_dir, item, output_dir)
            apply_provider_pause(output_dir)
    finally:
        release_dispatcher_lock(jobs_root)


def spawn_dispatcher(output_dir: Path) -> bool:
    jobs_root = output_dir / "jobs"
    jobs_root.mkdir(parents=True, exist_ok=True)
    existing = read_dispatcher_pid(jobs_root)
    if existing and is_pid_alive(existing):
        return False

    log_dir = output_dir / "dispatcher"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "dispatcher.log"
    with open(log_path, "a", encoding="utf-8") as logf:
        logf.write(f"\n\n===== dispatcher spawn {datetime.now().isoformat(timespec='seconds')} =====\n")
        logf.flush()
        subprocess.Popen(
            [sys.executable, str(Path(__file__).resolve()), "--output", str(output_dir)],
            stdout=logf,
            stderr=logf,
            stdin=subprocess.DEVNULL,
            cwd=str(SCRIPT_DIR.parent),
            start_new_session=True,
            env=os.environ.copy(),
        )
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="全局任务调度器")
    parser.add_argument("--output", default=str(Path(__file__).resolve().parent.parent / "output"), help="输出目录")
    parser.add_argument("--spawn", action="store_true", help="后台启动 dispatcher 后立刻返回")
    args = parser.parse_args()

    output_dir = Path(args.output).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    if args.spawn:
        started = spawn_dispatcher(output_dir)
        print("✅ dispatcher 已启动" if started else "⏩ dispatcher 已在运行")
        return 0

    return run_dispatcher(output_dir)


if __name__ == "__main__":
    raise SystemExit(main())
