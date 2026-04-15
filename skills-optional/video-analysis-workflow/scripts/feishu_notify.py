#!/usr/bin/env python3
"""Feishu report sender for video-analysis-workflow jobs."""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path

import requests

TOOLKIT_ENV = Path(__file__).resolve().parents[2] / "feishu-office-toolkit" / "server" / ".env"
AUTH_URL = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
UPLOAD_URL = "https://open.feishu.cn/open-apis/im/v1/files"
SEND_URL = "https://open.feishu.cn/open-apis/im/v1/messages"


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_dotenv(TOOLKIT_ENV)


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def get_credentials() -> tuple[str, str]:
    app_id = os.environ.get("FEISHU_APP_ID", "")
    app_secret = os.environ.get("FEISHU_APP_SECRET", "")
    if not app_id or not app_secret:
        raise RuntimeError("FEISHU_APP_ID / FEISHU_APP_SECRET 未配置")
    return app_id, app_secret


def get_tenant_token() -> str:
    app_id, app_secret = get_credentials()
    resp = requests.post(AUTH_URL, json={"app_id": app_id, "app_secret": app_secret}, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") != 0:
        raise RuntimeError(f"Feishu auth error: {data}")
    return data["tenant_access_token"]


def upload_file(file_path: Path, token: str) -> str:
    headers = {"Authorization": f"Bearer {token}"}
    with file_path.open("rb") as f:
        files = {
            "file_type": (None, "docx" if file_path.suffix.lower() == ".docx" else "stream"),
            "file_name": (None, file_path.name),
            "file": (file_path.name, f, "application/octet-stream"),
        }
        resp = requests.post(UPLOAD_URL, headers=headers, files=files, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") != 0:
        raise RuntimeError(f"Feishu upload error: {data}")
    return data["data"]["file_key"]


def send_text(receive_id: str, receive_id_type: str, text: str, token: str) -> str:
    payload = {
        "receive_id": receive_id,
        "msg_type": "text",
        "content": json.dumps({"text": text}, ensure_ascii=False),
    }
    resp = requests.post(
        SEND_URL,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=utf-8"},
        params={"receive_id_type": receive_id_type},
        json=payload,
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") != 0:
        raise RuntimeError(f"Feishu send text error: {data}")
    return data["data"]["message_id"]


def send_file(receive_id: str, receive_id_type: str, file_key: str, token: str) -> str:
    payload = {
        "receive_id": receive_id,
        "msg_type": "file",
        "content": json.dumps({"file_key": file_key}, ensure_ascii=False),
    }
    resp = requests.post(
        SEND_URL,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=utf-8"},
        params={"receive_id_type": receive_id_type},
        json=payload,
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") != 0:
        raise RuntimeError(f"Feishu send file error: {data}")
    return data["data"]["message_id"]


def should_send_job(job: dict) -> bool:
    if not job.get("feishu_send_enabled"):
        return False
    if not job.get("feishu_receive_id"):
        return False
    if not job.get("report_path"):
        return False
    target_status = job.get("status")
    sent_status = job.get("feishu_sent_status")
    if target_status == "completed":
        return sent_status != "completed"
    if target_status == "partial_done":
        return sent_status not in {"partial_done", "completed"}
    return False


def send_job_report(job: dict) -> dict:
    report_path = Path(job["report_path"])
    if not report_path.exists():
        raise FileNotFoundError(f"报告不存在: {report_path}")

    token = get_tenant_token()
    receive_id = job["feishu_receive_id"]
    receive_id_type = job.get("feishu_receive_id_type", "open_id")

    summary = (
        f"视频分析任务完成\n"
        f"job_id: {job.get('job_id')}\n"
        f"状态: {job.get('status')}\n"
        f"成功率: {job.get('completeness', 0.0) * 100:.1f}%\n"
        f"镜头: {job.get('success', 0)}/{job.get('total_scenes', 0)}\n"
        f"失败: {job.get('failed', 0)}  跳过: {job.get('skipped', 0)}"
    )

    summary_message_id = send_text(receive_id, receive_id_type, summary, token)
    file_key = upload_file(report_path, token)
    file_message_id = send_file(receive_id, receive_id_type, file_key, token)

    return {
        "feishu_sent": True,
        "feishu_sent_at": now_iso(),
        "feishu_sent_status": job.get("status"),
        "feishu_summary_message_id": summary_message_id,
        "feishu_message_id": file_message_id,
        "feishu_last_error": None,
    }
