#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request


DEFAULT_BASE_URL = os.getenv("SUNO_API_BASE_URL", "http://localhost:3001").rstrip("/")
SCRIPT_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "scripts", "suno_api.py")


def fetch_json(url: str, timeout: float = 10.0):
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        body = resp.read().decode("utf-8", errors="replace")
        try:
            return resp.status, json.loads(body)
        except json.JSONDecodeError:
            return resp.status, body


def run_cli(*args):
    proc = subprocess.run(
        [sys.executable, SCRIPT_PATH, *args],
        check=False,
        capture_output=True,
        text=True,
        env=os.environ.copy(),
    )
    return proc.returncode, proc.stdout, proc.stderr


def main():
    parser = argparse.ArgumentParser(description="Smoke test for a running local suno-api service")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--ids", help="Optional comma-separated song ids for /api/get verification")
    parser.add_argument("--timeout", type=float, default=10.0)
    args = parser.parse_args()

    base = args.base_url.rstrip("/")
    results = {"base_url": base, "checks": []}

    try:
        status, data = fetch_json(f"{base}/api/get_limit", timeout=args.timeout)
        results["checks"].append({"name": "http_get_limit", "ok": status == 200, "status": status, "preview": data})
    except Exception as e:
        results["checks"].append({"name": "http_get_limit", "ok": False, "error": repr(e)})
        print(json.dumps(results, ensure_ascii=False, indent=2))
        sys.exit(1)

    code, stdout, stderr = run_cli("get-limit")
    cli_ok = False
    cli_preview = stdout.strip()
    if code == 0:
        try:
            parsed = json.loads(stdout)
            cli_ok = parsed.get("status") == 200
            cli_preview = parsed
        except json.JSONDecodeError:
            cli_ok = False
    results["checks"].append(
        {"name": "cli_get_limit", "ok": cli_ok, "exit_code": code, "stdout": cli_preview, "stderr": stderr.strip()}
    )

    if args.ids:
        try:
            status, data = fetch_json(f"{base}/api/get?ids={args.ids}", timeout=args.timeout)
            results["checks"].append({"name": "http_get_ids", "ok": status == 200, "status": status, "preview": data})
        except Exception as e:
            results["checks"].append({"name": "http_get_ids", "ok": False, "error": repr(e)})

        code, stdout, stderr = run_cli("get", "--ids", args.ids)
        cli_ok = False
        cli_preview = stdout.strip()
        if code == 0:
            try:
                parsed = json.loads(stdout)
                cli_ok = parsed.get("status") == 200
                cli_preview = parsed
            except json.JSONDecodeError:
                cli_ok = False
        results["checks"].append(
            {"name": "cli_get_ids", "ok": cli_ok, "exit_code": code, "stdout": cli_preview, "stderr": stderr.strip()}
        )

    results["ok"] = all(check.get("ok") for check in results["checks"])
    print(json.dumps(results, ensure_ascii=False, indent=2))
    sys.exit(0 if results["ok"] else 1)


if __name__ == "__main__":
    main()
