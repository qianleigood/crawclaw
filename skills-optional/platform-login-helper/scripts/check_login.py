#!/usr/bin/env python3
import argparse
import json
import shlex
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

EXIT_ALL_LOGGED_IN = 0
EXIT_HAS_NOT_LOGGED_IN = 1
EXIT_CHECK_BLOCKED = 2

DEFAULT_XHS_SKILL_ROOT = Path(__file__).resolve().parents[2] / "redbook-skills"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_platforms(raw: str) -> list[str]:
    aliases = {
        "xhs": "xiaohongshu",
        "xiaohongshu": "xiaohongshu",
        "redbook": "xiaohongshu",
        "douyin": "douyin",
    }
    items = [item.strip().lower() for item in raw.split(",") if item.strip()]
    seen = set()
    out: list[str] = []
    for item in items:
        normalized = aliases.get(item, item)
        if normalized not in seen:
            seen.add(normalized)
            out.append(normalized)
    return out


def read_json_file(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def resolve_xhs_default_account(skill_root: Path) -> str:
    accounts_file = skill_root / "config" / "accounts.json"
    payload = read_json_file(accounts_file) or {}
    default_account = str(payload.get("default_account") or "").strip()
    return default_account or "default"


def split_xhs_cache_key(key: str) -> tuple[str, int | None, str, str] | None:
    parts = key.split(":")
    if len(parts) != 4:
        return None
    host, port_raw, account, scope = parts
    try:
        port = int(port_raw)
    except Exception:
        port = None
    return host, port, account, scope


def find_xhs_cache_entry(
    *,
    skill_root: Path,
    host: str,
    port: int | None,
    account: str,
    scope: str,
    ttl_hours: float,
) -> dict[str, Any] | None:
    cache_path = skill_root / "tmp" / "login_status_cache.json"
    payload = read_json_file(cache_path)
    if not payload:
        return None
    entries = payload.get("entries")
    if not isinstance(entries, dict):
        return None

    now_ts = int(time.time())
    best: dict[str, Any] | None = None
    best_checked_at = -1
    for key, value in entries.items():
        parsed = split_xhs_cache_key(str(key))
        if not parsed or not isinstance(value, dict):
            continue
        entry_host, entry_port, entry_account, entry_scope = parsed
        if entry_host != host:
            continue
        if port is not None and entry_port != port:
            continue
        if entry_account != account or entry_scope != scope:
            continue
        checked_at = value.get("checked_at")
        if not isinstance(checked_at, (int, float)):
            continue
        age_seconds = now_ts - int(checked_at)
        if age_seconds < 0 or age_seconds > ttl_hours * 3600:
            continue
        candidate = {
            "logged_in": bool(value.get("logged_in")),
            "checked_at": int(checked_at),
            "age_seconds": age_seconds,
            "host": entry_host,
            "port": entry_port,
            "account": entry_account,
            "scope": entry_scope,
            "source": "xhs_cache",
            "cache_path": str(cache_path),
        }
        if int(checked_at) > best_checked_at:
            best_checked_at = int(checked_at)
            best = candidate
    return best


def run_shell_command(command: str, timeout_seconds: int) -> dict[str, Any]:
    started_at = time.time()
    try:
        completed = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
        )
        duration_ms = int((time.time() - started_at) * 1000)
        return {
            "ok": completed.returncode == 0,
            "timed_out": False,
            "exit_code": completed.returncode,
            "stdout": completed.stdout,
            "stderr": completed.stderr,
            "duration_ms": duration_ms,
            "command": command,
        }
    except subprocess.TimeoutExpired as exc:
        duration_ms = int((time.time() - started_at) * 1000)
        return {
            "ok": False,
            "timed_out": True,
            "exit_code": None,
            "stdout": exc.stdout or "",
            "stderr": exc.stderr or "",
            "duration_ms": duration_ms,
            "command": command,
        }


def status_from_runner_result(result: dict[str, Any]) -> tuple[str, bool | None, str]:
    if result.get("timed_out"):
        return "timeout", None, "登录检查超时"

    exit_code = result.get("exit_code")
    stdout = str(result.get("stdout") or "")
    stderr = str(result.get("stderr") or "")
    combined = f"{stdout}\n{stderr}".lower()

    if exit_code == 0:
        return "logged_in", True, "登录检查通过"

    if "devtools endpoint returned 404" in combined or "does not expose a valid chrome devtools endpoint" in combined:
        return "blocked", None, "浏览器调试端口不可用，无法完成实时登录检查"

    if exit_code == 1:
        if "not_logged_in" in combined or "is not logged in" in combined or "login" in combined:
            return "not_logged_in", False, "未登录或登录态失效"
        return "not_logged_in", False, "登录检查返回未通过"

    return "error", None, f"登录检查异常，退出码 {exit_code}"


def build_xhs_live_command(
    *,
    skill_root: Path,
    account: str,
    port: int | None,
    scope: str,
    launch_browser: bool,
) -> str:
    run_python = skill_root / "run-python.sh"
    run_puppeteer = skill_root / "run-puppeteer.sh"
    launcher_script = skill_root / "scripts" / "chrome_launcher.py"

    parts: list[str] = []
    if launch_browser:
        launcher = [shlex.quote(str(run_python)), shlex.quote(str(launcher_script)), "--account", shlex.quote(account)]
        if port is not None:
            launcher.extend(["--port", shlex.quote(str(port))])
        parts.append(" ".join(launcher))

    checker = [shlex.quote(str(run_puppeteer)), "check-login", "--account", shlex.quote(account), "--scope", shlex.quote(scope)]
    if port is not None:
        checker.extend(["--port", shlex.quote(str(port))])
    parts.append(" ".join(checker))
    return " && ".join(parts)


def check_xiaohongshu(args: argparse.Namespace) -> dict[str, Any]:
    skill_root = Path(args.xhs_skill_root).expanduser()
    account = args.xhs_account or resolve_xhs_default_account(skill_root)
    result: dict[str, Any] = {
        "platform": "xiaohongshu",
        "supported": True,
        "account": account,
        "scope": args.xhs_scope,
        "host": args.xhs_host,
        "port": args.xhs_port,
        "mode": args.xhs_mode,
    }

    if not skill_root.exists():
        result.update({
            "supported": False,
            "status": "unsupported",
            "logged_in": None,
            "message": f"未找到小红书 skill 目录：{skill_root}",
        })
        return result

    if args.xhs_mode in {"auto", "cache"}:
        cached = find_xhs_cache_entry(
            skill_root=skill_root,
            host=args.xhs_host,
            port=args.xhs_port,
            account=account,
            scope=args.xhs_scope,
            ttl_hours=args.xhs_cache_ttl_hours,
        )
        if cached:
            result.update({
                "status": "logged_in" if cached.get("logged_in") else "not_logged_in",
                "logged_in": bool(cached.get("logged_in")),
                "message": "命中小红书登录缓存",
                "source": cached.get("source"),
                "cache_checked_at": datetime.fromtimestamp(cached["checked_at"], tz=timezone.utc).isoformat(),
                "cache_age_seconds": cached.get("age_seconds"),
                "cache_path": cached.get("cache_path"),
                "port": cached.get("port"),
            })
            return result
        if args.xhs_mode == "cache":
            result.update({
                "status": "blocked",
                "logged_in": None,
                "message": "未命中可用的小红书登录缓存",
            })
            return result

    command = args.xhs_command or build_xhs_live_command(
        skill_root=skill_root,
        account=account,
        port=args.xhs_port,
        scope=args.xhs_scope,
        launch_browser=args.xhs_launch_browser,
    )
    run_result = run_shell_command(command, args.timeout)
    status, logged_in, message = status_from_runner_result(run_result)
    result.update({
        "status": status,
        "logged_in": logged_in,
        "message": message,
        "source": "xhs_live_check" if not args.xhs_command else "xhs_custom_command",
        "command": command,
        "exit_code": run_result.get("exit_code"),
        "duration_ms": run_result.get("duration_ms"),
        "stdout": run_result.get("stdout"),
        "stderr": run_result.get("stderr"),
        "timed_out": run_result.get("timed_out"),
    })
    return result


def check_douyin(args: argparse.Namespace) -> dict[str, Any]:
    result: dict[str, Any] = {
        "platform": "douyin",
        "supported": bool(args.douyin_command),
        "mode": "custom_command" if args.douyin_command else "unwired",
    }
    if not args.douyin_command:
        result.update({
            "status": "unsupported",
            "logged_in": None,
            "message": "抖音登录检查入口尚未接入，当前先阻断真实采集。",
        })
        return result

    run_result = run_shell_command(args.douyin_command, args.timeout)
    status, logged_in, message = status_from_runner_result(run_result)
    result.update({
        "status": status,
        "logged_in": logged_in,
        "message": message,
        "source": "douyin_custom_command",
        "command": args.douyin_command,
        "exit_code": run_result.get("exit_code"),
        "duration_ms": run_result.get("duration_ms"),
        "stdout": run_result.get("stdout"),
        "stderr": run_result.get("stderr"),
        "timed_out": run_result.get("timed_out"),
    })
    return result


def overall_exit_code(results: list[dict[str, Any]]) -> int:
    statuses = [item.get("status") for item in results]
    if any(status in {"unsupported", "blocked", "timeout", "error"} for status in statuses):
        return EXIT_CHECK_BLOCKED
    if any(status == "not_logged_in" for status in statuses):
        return EXIT_HAS_NOT_LOGGED_IN
    return EXIT_ALL_LOGGED_IN


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Reusable platform login gate.")
    parser.add_argument("--platforms", default="xiaohongshu", help="Comma-separated platforms: xiaohongshu,douyin")
    parser.add_argument("--timeout", type=int, default=45, help="Per-platform live check timeout in seconds")

    parser.add_argument("--xhs-skill-root", default=str(DEFAULT_XHS_SKILL_ROOT), help="Path to redbook-skills root (xiaohongshuskills compatibility path also works)")
    parser.add_argument("--xhs-account", help="Xiaohongshu account name; defaults to redbook-skills default_account")
    parser.add_argument("--xhs-host", default="127.0.0.1", help="Xiaohongshu CDP host")
    parser.add_argument("--xhs-port", type=int, help="Xiaohongshu CDP port; if omitted, cache lookup can match any recent port")
    parser.add_argument("--xhs-scope", choices=["creator", "home"], default="creator", help="Xiaohongshu login scope")
    parser.add_argument("--xhs-mode", choices=["auto", "cache", "live"], default="auto", help="auto=cache first then live; cache=cache only; live=force live check")
    parser.add_argument("--xhs-cache-ttl-hours", type=float, default=12.0, help="Freshness window for xiaohongshu login cache")
    parser.add_argument("--xhs-launch-browser", action="store_true", help="Launch or relaunch XHS Chrome before live check")
    parser.add_argument("--xhs-command", help="Override Xiaohongshu live check command (for testing/debugging)")

    parser.add_argument("--douyin-command", help="Custom Douyin login check command; exit 0=logged in, 1=not logged in")
    return parser


def main(argv: list[str]) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    platforms = parse_platforms(args.platforms)
    if not platforms:
        parser.error("No valid platforms provided.")

    results: list[dict[str, Any]] = []
    for platform in platforms:
        if platform == "xiaohongshu":
            results.append(check_xiaohongshu(args))
        elif platform == "douyin":
            results.append(check_douyin(args))
        else:
            results.append({
                "platform": platform,
                "supported": False,
                "status": "unsupported",
                "logged_in": None,
                "message": f"Unsupported platform: {platform}",
            })

    payload = {
        "checked_at": now_iso(),
        "requested_platforms": platforms,
        "all_logged_in": all(item.get("status") == "logged_in" for item in results),
        "has_not_logged_in": any(item.get("status") == "not_logged_in" for item in results),
        "has_blocked_checks": any(item.get("status") in {"unsupported", "blocked", "timeout", "error"} for item in results),
        "results": results,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return overall_exit_code(results)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
