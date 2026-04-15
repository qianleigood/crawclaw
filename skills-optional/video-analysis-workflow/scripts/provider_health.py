#!/usr/bin/env python3
"""Provider health tracking and circuit breaker for video analysis."""

from __future__ import annotations

import json
from collections import deque
from datetime import datetime, timedelta
from pathlib import Path

HEALTH_FILE = "provider_health.json"
MAX_EVENTS = 20
FAILURE_RATE_THRESHOLD = 0.7
CONSECUTIVE_FAILURES_THRESHOLD = 5
BREAKER_OPEN_MINUTES = 15


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def health_file(output_dir: Path) -> Path:
    return output_dir / HEALTH_FILE


def load_health(output_dir: Path) -> dict:
    path = health_file(output_dir)
    if not path.exists():
        return {
            "events": [],
            "consecutive_failures": 0,
            "breaker_open_until": None,
            "last_error": None,
            "updated_at": now_iso(),
        }
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {
            "events": [],
            "consecutive_failures": 0,
            "breaker_open_until": None,
            "last_error": "health file parse error",
            "updated_at": now_iso(),
        }


def save_health(output_dir: Path, health: dict) -> None:
    health["updated_at"] = now_iso()
    health_file(output_dir).write_text(json.dumps(health, ensure_ascii=False, indent=2), encoding="utf-8")


def is_breaker_open(output_dir: Path) -> bool:
    health = load_health(output_dir)
    until = health.get("breaker_open_until")
    if not until:
        return False
    try:
        return datetime.fromisoformat(until) > datetime.now()
    except Exception:
        return False


def breaker_status(output_dir: Path) -> dict:
    health = load_health(output_dir)
    return {
        "open": is_breaker_open(output_dir),
        "open_until": health.get("breaker_open_until"),
        "consecutive_failures": health.get("consecutive_failures", 0),
        "last_error": health.get("last_error"),
        "recent_events": len(health.get("events", [])),
    }


def close_breaker_if_expired(output_dir: Path) -> dict:
    health = load_health(output_dir)
    until = health.get("breaker_open_until")
    if until:
        try:
            if datetime.fromisoformat(until) <= datetime.now():
                health["breaker_open_until"] = None
                health["last_error"] = None
                save_health(output_dir, health)
        except Exception:
            health["breaker_open_until"] = None
            save_health(output_dir, health)
    return health


def open_breaker(output_dir: Path, reason: str) -> dict:
    health = load_health(output_dir)
    health["breaker_open_until"] = (datetime.now() + timedelta(minutes=BREAKER_OPEN_MINUTES)).isoformat(timespec="seconds")
    health["last_error"] = reason
    save_health(output_dir, health)
    return health


def record_scene_result(output_dir: Path, status: str, error: str | None = None) -> dict:
    health = close_breaker_if_expired(output_dir)
    events = deque(health.get("events", []), maxlen=MAX_EVENTS)
    event = {"at": now_iso(), "status": status, "ok": status in {"success", "skipped"}, "error": error}
    events.append(event)
    health["events"] = list(events)

    if event["ok"]:
        health["consecutive_failures"] = 0
    else:
        health["consecutive_failures"] = int(health.get("consecutive_failures", 0)) + 1
        health["last_error"] = error or status

    recent = health["events"]
    if recent:
        failures = sum(1 for x in recent if not x.get("ok"))
        failure_rate = failures / len(recent)
    else:
        failure_rate = 0.0

    if health["consecutive_failures"] >= CONSECUTIVE_FAILURES_THRESHOLD:
        open_breaker(output_dir, f"连续失败 {health['consecutive_failures']} 次")
        health = load_health(output_dir)
    elif len(recent) >= 10 and failure_rate >= FAILURE_RATE_THRESHOLD:
        open_breaker(output_dir, f"最近 {len(recent)} 次失败率 {failure_rate:.0%}")
        health = load_health(output_dir)
    else:
        save_health(output_dir, health)

    return health
