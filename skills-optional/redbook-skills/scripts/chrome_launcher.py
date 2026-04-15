"""
Chrome launcher with CDP remote debugging support.

Manages a dedicated Chrome instance for Xiaohongshu publishing:
- Detects if Chrome is already listening on the debug port
- Launches Chrome with a dedicated user-data-dir for login persistence
- Waits for the debug port to become available
- Supports headless mode for automated publishing without GUI
- Supports switching between headless and headed mode (e.g. for login)
- Supports multiple accounts with separate profile directories
"""

import os
import sys
import time
import socket
import shlex
import signal
import subprocess
from typing import Optional
from urllib import request as urllib_request
from urllib import error as urllib_error


CDP_PORT = 9222
PROFILE_DIR_NAME = "XiaohongshuProfile"
STARTUP_TIMEOUT = 15  # seconds to wait for Chrome to start

# Track the Chrome process we launched so we can kill it later
_chrome_process: subprocess.Popen | None = None
# Track the current account being used
_current_account: Optional[str] = None


def get_chrome_path() -> str:
    """Find Chrome executable on Windows/macOS/Linux."""
    candidates = []

    if sys.platform == "win32":
        for env_var in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"):
            base = os.environ.get(env_var, "")
            if base:
                candidates.append(
                    os.path.join(base, "Google", "Chrome", "Application", "chrome.exe")
                )
    elif sys.platform == "darwin":
        candidates.extend(
            [
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                os.path.expanduser("~/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
            ]
        )
    else:
        candidates.extend(
            [
                "/usr/bin/google-chrome",
                "/usr/bin/google-chrome-stable",
                "/usr/bin/chromium-browser",
                "/usr/bin/chromium",
            ]
        )

    for path in candidates:
        if os.path.isfile(path):
            return path

    import shutil
    found = (
        shutil.which("google-chrome")
        or shutil.which("google-chrome-stable")
        or shutil.which("chromium-browser")
        or shutil.which("chromium")
        or shutil.which("chrome")
        or shutil.which("chrome.exe")
    )
    if found:
        return found

    raise FileNotFoundError(
        "Chrome not found. Please install Google Chrome or set its path manually."
    )


def _resolve_account_name(account: Optional[str] = None) -> str:
    """Resolve explicit or default account name."""
    if account and account.strip():
        return account.strip()
    try:
        from account_manager import get_default_account
        resolved = get_default_account()
        if isinstance(resolved, str) and resolved.strip():
            return resolved.strip()
    except Exception:
        pass
    return "default"


def resolve_debug_port(account: Optional[str] = None, explicit_port: Optional[int] = None) -> int:
    """Resolve explicit port or fall back to the account's preferred port."""
    if explicit_port is not None:
        return int(explicit_port)
    try:
        from account_manager import resolve_debug_port as resolve_account_debug_port
        return int(resolve_account_debug_port(_resolve_account_name(account), None))
    except Exception:
        return CDP_PORT


def get_user_data_dir(account: Optional[str] = None) -> str:
    """
    Return the Chrome profile directory path for a given account.

    Args:
        account: Account name. If None, uses the default account from account_manager.

    Returns:
        Path to the Chrome user-data-dir for this account.
    """
    try:
        from account_manager import get_profile_dir
        return get_profile_dir(account)
    except ImportError:
        # Fallback if account_manager not available
        local_app_data = os.environ.get("LOCALAPPDATA", "")
        if not local_app_data:
            local_app_data = os.path.expanduser("~")
        return os.path.join(local_app_data, "Google", "Chrome", PROFILE_DIR_NAME)


def is_port_open(port: int, host: str = "127.0.0.1") -> bool:
    """Check if a TCP port is accepting connections."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1)
        try:
            s.connect((host, port))
            return True
        except (ConnectionRefusedError, socket.timeout, OSError):
            return False


def is_cdp_endpoint_ready(port: int, host: str = "127.0.0.1") -> bool:
    """Return True only when one port exposes a valid Chrome DevTools HTTP endpoint."""
    url = f"http://{host}:{port}/json/version"
    try:
        with urllib_request.urlopen(url, timeout=2) as resp:
            if getattr(resp, "status", None) != 200:
                return False
            body = resp.read().decode("utf-8", errors="replace")
    except (urllib_error.URLError, TimeoutError, OSError, ValueError):
        return False

    try:
        import json
        payload = json.loads(body)
    except Exception:
        return False

    if not isinstance(payload, dict):
        return False
    ws_url = payload.get("webSocketDebuggerUrl")
    return isinstance(ws_url, str) and ws_url.startswith("ws")


def _normalize_path(path: str) -> str:
    """Normalize one filesystem path for comparison."""
    return os.path.normcase(os.path.realpath(os.path.abspath(os.path.expanduser(path))))


def _get_listening_pid_by_port(port: int) -> Optional[int]:
    """Return the PID listening on one TCP port when discoverable."""
    commands = []
    if sys.platform != "win32":
        commands.append(["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"])
    else:
        commands.append(["netstat", "-ano"])

    for cmd in commands:
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
        except Exception:
            continue
        if result.returncode not in (0, 1):
            continue

        output = (result.stdout or "").strip()
        if not output:
            continue

        if cmd[0] == "lsof":
            first_line = output.splitlines()[0].strip()
            if first_line.isdigit():
                return int(first_line)
        else:
            for line in output.splitlines():
                if f":{port}" in line and "LISTEN" in line.upper():
                    pid = line.strip().split()[-1]
                    if pid.isdigit():
                        return int(pid)
    return None


def _get_process_command(pid: int) -> Optional[str]:
    """Return full process command line for one PID when available."""
    try:
        if sys.platform == "win32":
            result = subprocess.run(
                ["wmic", "process", "where", f"processid={pid}", "get", "commandline", "/value"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if result.returncode == 0:
                for line in (result.stdout or "").splitlines():
                    if line.startswith("CommandLine="):
                        value = line.split("=", 1)[1].strip()
                        return value or None
        else:
            result = subprocess.run(
                ["ps", "-p", str(pid), "-o", "command="],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if result.returncode == 0:
                value = (result.stdout or "").strip()
                return value or None
    except Exception:
        return None
    return None


def _extract_user_data_dir_from_command(command: str) -> Optional[str]:
    """Extract --user-data-dir from a Chrome command line."""
    try:
        parts = shlex.split(command, posix=(sys.platform != "win32"))
    except Exception:
        parts = command.split()

    prefix = "--user-data-dir="
    for part in parts:
        if part.startswith(prefix):
            value = part[len(prefix):].strip()
            if value:
                return value
    return None


def _extract_remote_debugging_port_from_command(command: str) -> Optional[int]:
    """Extract --remote-debugging-port from a Chrome command line when present."""
    try:
        parts = shlex.split(command, posix=(sys.platform != "win32"))
    except Exception:
        parts = command.split()

    prefix = "--remote-debugging-port="
    for part in parts:
        if part.startswith(prefix):
            value = part[len(prefix):].strip()
            if value.isdigit():
                return int(value)
    return None


def _list_processes() -> list[tuple[int, str]]:
    """Return visible processes as (pid, command) tuples."""
    try:
        result = subprocess.run(
            ["ps", "-axo", "pid=,command="],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except Exception:
        return []

    if result.returncode != 0:
        return []

    rows: list[tuple[int, str]] = []
    for line in (result.stdout or "").splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        parts = stripped.split(None, 1)
        if not parts or not parts[0].isdigit():
            continue
        pid = int(parts[0])
        command = parts[1] if len(parts) > 1 else ""
        rows.append((pid, command))
    return rows


def _find_chrome_processes_by_user_data_dir(user_data_dir: str) -> list[dict[str, object]]:
    """Find Chrome processes that are using one specific user-data-dir."""
    expected = _normalize_path(user_data_dir)
    matches: list[dict[str, object]] = []
    for pid, command in _list_processes():
        if "Google Chrome" not in command and "chrome" not in command.lower():
            continue
        actual = _extract_user_data_dir_from_command(command)
        if not actual:
            continue
        if _normalize_path(actual) != expected:
            continue
        matches.append({
            "pid": pid,
            "command": command,
            "port": _extract_remote_debugging_port_from_command(command),
        })
    return matches


def _pid_exists(pid: int) -> bool:
    """Return True when a PID still exists."""
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _terminate_process_tree(pid: int) -> None:
    """Best-effort terminate one process."""
    if not _pid_exists(pid):
        return
    try:
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/F", "/PID", str(pid)], capture_output=True, timeout=5)
            return
        os.kill(pid, signal.SIGTERM)
    except Exception:
        pass

    deadline = time.time() + 5
    while time.time() < deadline:
        if not _pid_exists(pid):
            return
        time.sleep(0.2)

    try:
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/F", "/PID", str(pid)], capture_output=True, timeout=5)
        else:
            os.kill(pid, signal.SIGKILL)
    except Exception:
        pass


def _recover_profile_conflict(
    port: int,
    headless: bool,
    account: Optional[str],
) -> bool:
    """Kill conflicting Chrome instances for the same profile and retry launch once."""
    user_data_dir = get_user_data_dir(account)
    conflicts = [
        proc for proc in _find_chrome_processes_by_user_data_dir(user_data_dir)
        if proc.get("port") != port
    ]
    if not conflicts:
        return False

    account_label = account or "default"
    conflict_desc = ", ".join(
        f"pid={proc['pid']} port={proc.get('port') or '-'}"
        for proc in conflicts
    )
    print(
        "[chrome_launcher] Detected conflicting Chrome instance(s) for "
        f"account '{account_label}' profile: {conflict_desc}. "
        f"Terminating and relaunching on port {port}."
    )
    for proc in conflicts:
        _terminate_process_tree(int(proc["pid"]))

    deadline = time.time() + 8
    while time.time() < deadline:
        remaining = [
            proc for proc in _find_chrome_processes_by_user_data_dir(user_data_dir)
            if proc.get("port") != port
        ]
        if not remaining:
            break
        time.sleep(0.3)

    relaunch = launch_chrome(port=port, headless=headless, account=account)
    return is_port_open(port) or (relaunch is not None and is_port_open(port))


def ensure_account_port_matches(port: int, account: Optional[str]) -> tuple[bool, str]:
    """Check whether an occupied port belongs to the expected account profile."""
    resolved_account = _resolve_account_name(account)
    expected_profile = _normalize_path(get_user_data_dir(resolved_account))
    pid = _get_listening_pid_by_port(port)
    if pid is None:
        return True, (
            f"Port {port} is already open, but the listening process could not be identified. "
            f"Proceeding with the existing debugger endpoint for account '{resolved_account}'."
        )

    command = _get_process_command(pid)
    if not command:
        return False, f"Could not inspect command line for pid {pid} on port {port}."

    actual_profile = _extract_user_data_dir_from_command(command)
    if not actual_profile:
        return False, (
            f"Port {port} is occupied by pid {pid}, but its command line does not expose "
            "--user-data-dir; refusing to guess account ownership."
        )

    actual_profile_normalized = _normalize_path(actual_profile)
    if actual_profile_normalized != expected_profile:
        return False, (
            f"Port {port} is already occupied by a different Chrome profile. "
            f"expected={expected_profile} actual={actual_profile_normalized} pid={pid}"
        )
    return True, f"Port {port} already belongs to account '{resolved_account}'."


def launch_chrome(
    port: int = CDP_PORT,
    headless: bool = False,
    account: Optional[str] = None,
) -> subprocess.Popen | None:
    """
    Launch Chrome with remote debugging enabled.

    Args:
        port: CDP remote debugging port.
        headless: If True, launch Chrome in headless mode (no GUI window).
        account: Account name to use. If None, uses the default account.

    Returns the Popen object if a new process was started, or None if Chrome
    was already running on the target port.
    """
    global _chrome_process, _current_account

    if is_port_open(port):
        if not is_cdp_endpoint_ready(port):
            raise RuntimeError(
                f"[chrome_launcher] Port {port} is open but does not expose a valid Chrome DevTools endpoint. "
                "Refusing to reuse this port."
            )
        ok, detail = ensure_account_port_matches(port, account)
        if not ok:
            raise RuntimeError(f"[chrome_launcher] {detail}")
        print(f"[chrome_launcher] Chrome already running on port {port}.")
        print(f"[chrome_launcher] {detail}")
        return None

    chrome_path = get_chrome_path()
    user_data_dir = get_user_data_dir(account)
    _current_account = account

    cmd = [
        chrome_path,
        f"--remote-debugging-port={port}",
        f"--user-data-dir={user_data_dir}",
        "--no-first-run",
        "--no-default-browser-check",
    ]

    if headless:
        cmd.append("--headless=new")

    mode_label = "headless" if headless else "headed"
    account_label = account or "default"
    print(f"[chrome_launcher] Launching Chrome ({mode_label}, account: {account_label})...")
    print(f"  executable : {chrome_path}")
    print(f"  profile dir: {user_data_dir}")
    print(f"  debug port : {port}")

    if sys.platform == "darwin":
        quoted_args = [
            "open",
            "-na",
            "Google Chrome",
            "--args",
            *cmd[1:],
        ]
        proc = subprocess.Popen(
            quoted_args,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    else:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    _chrome_process = proc

    # Wait for the debug port to become available
    deadline = time.time() + STARTUP_TIMEOUT
    while time.time() < deadline:
        if is_cdp_endpoint_ready(port):
            print(f"[chrome_launcher] Chrome is ready on port {port}.")
            return proc
        if proc.poll() is not None and sys.platform != "darwin":
            print(
                f"[chrome_launcher] WARNING: Chrome exited before port {port} became ready "
                f"(exit={proc.returncode}).",
                file=sys.stderr,
            )
            return proc
        time.sleep(0.5)

    print(
        f"[chrome_launcher] WARNING: Chrome started but CDP endpoint on port {port} did not become ready "
        f"after {STARTUP_TIMEOUT}s.",
        file=sys.stderr,
    )
    return proc


def kill_chrome(port: int = CDP_PORT):
    """
    Kill the Chrome instance on the given debug port.

    Tries multiple strategies:
    1. Send CDP Browser.close command via HTTP
    2. Terminate the tracked subprocess
    3. Kill by port on Windows (taskkill)
    """
    global _chrome_process

    # Strategy 1: CDP Browser.close
    try:
        import requests
        resp = requests.get(f"http://127.0.0.1:{port}/json/version", timeout=2)
        if resp.ok:
            ws_url = resp.json().get("webSocketDebuggerUrl")
            if ws_url:
                import websockets.sync.client as ws_client
                ws = ws_client.connect(ws_url)
                ws.send('{"id":1,"method":"Browser.close"}')
                try:
                    ws.recv(timeout=2)
                except Exception:
                    pass
                ws.close()
                print("[chrome_launcher] Sent Browser.close via CDP.")
    except Exception:
        pass

    # Wait briefly for Chrome to shut down
    time.sleep(1)

    # Strategy 2: Terminate tracked subprocess
    if _chrome_process and _chrome_process.poll() is None:
        try:
            _chrome_process.terminate()
            _chrome_process.wait(timeout=5)
            print("[chrome_launcher] Terminated tracked Chrome process.")
        except Exception:
            try:
                _chrome_process.kill()
            except Exception:
                pass
    _chrome_process = None

    # Strategy 3: Windows taskkill by port (fallback)
    if sys.platform == "win32" and is_port_open(port):
        try:
            result = subprocess.run(
                ["netstat", "-ano"],
                capture_output=True, text=True, timeout=5
            )
            for line in result.stdout.splitlines():
                if f":{port}" in line and "LISTENING" in line:
                    pid = line.strip().split()[-1]
                    subprocess.run(
                        ["taskkill", "/F", "/PID", pid],
                        capture_output=True, timeout=5
                    )
                    print(f"[chrome_launcher] Killed process {pid} via taskkill.")
                    break
        except Exception:
            pass

    # Wait for port to be released
    deadline = time.time() + 5
    while time.time() < deadline:
        if not is_port_open(port):
            return
        time.sleep(0.5)

    if is_port_open(port):
        print(f"[chrome_launcher] WARNING: port {port} still open after kill attempt.",
              file=sys.stderr)


def restart_chrome(
    port: int = CDP_PORT,
    headless: bool = False,
    account: Optional[str] = None,
) -> subprocess.Popen | None:
    """
    Kill the current Chrome instance and relaunch with the specified mode.

    Useful for switching between headless and headed mode (e.g. when login
    is needed during a headless session), or switching accounts.

    Args:
        port: CDP remote debugging port.
        headless: If True, relaunch in headless mode.
        account: Account name to use. If None, uses the default account.

    Returns the Popen object for the new Chrome process.
    """
    account_label = account or "default"
    mode_label = "headless" if headless else "headed"
    print(f"[chrome_launcher] Restarting Chrome ({mode_label}, account: {account_label})...")
    kill_chrome(port)
    time.sleep(1)
    return launch_chrome(port, headless=headless, account=account)


def ensure_chrome(
    port: int = CDP_PORT,
    headless: bool = False,
    account: Optional[str] = None,
) -> bool:
    """
    Ensure Chrome is running with remote debugging on the given port.

    Args:
        port: CDP remote debugging port.
        headless: If True, launch in headless mode when starting a new instance.
            If Chrome is already running, this parameter is ignored.
        account: Account name to use. If None, uses the default account.

    Returns True if Chrome is available, False otherwise.
    """
    if is_port_open(port):
        if not is_cdp_endpoint_ready(port):
            print(
                f"[chrome_launcher] Error: port {port} is open but does not expose a valid Chrome DevTools endpoint.",
                file=sys.stderr,
            )
            return False
        ok, detail = ensure_account_port_matches(port, account)
        if not ok:
            print(f"[chrome_launcher] Error: {detail}", file=sys.stderr)
            return False
        print(f"[chrome_launcher] {detail}")
        return True
    try:
        proc = launch_chrome(port, headless=headless, account=account)
        if is_port_open(port):
            return True
        if proc is not None and proc.poll() is not None:
            if _recover_profile_conflict(port=port, headless=headless, account=account):
                return True
        return is_port_open(port)
    except (FileNotFoundError, RuntimeError) as e:
        print(f"[chrome_launcher] Error: {e}", file=sys.stderr)
        return False


def get_current_account() -> Optional[str]:
    """Get the name of the currently active account."""
    return _current_account


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Chrome Launcher for CDP")
    parser.add_argument("--port", type=int, default=None,
                        help="CDP remote debugging port (default: account preferred port or 9222)")
    parser.add_argument("--headless", action="store_true", help="Launch in headless mode")
    parser.add_argument("--kill", action="store_true", help="Kill the running Chrome instance")
    parser.add_argument("--restart", action="store_true", help="Restart Chrome")
    parser.add_argument("--account", help="Account name to use (default: default account)")
    args = parser.parse_args()

    resolved_port = resolve_debug_port(account=args.account, explicit_port=args.port)

    if args.kill:
        kill_chrome(port=resolved_port)
        print("[chrome_launcher] Chrome killed.")
    elif args.restart:
        restart_chrome(port=resolved_port, headless=args.headless, account=args.account)
        print("[chrome_launcher] Chrome restarted.")
    elif ensure_chrome(port=resolved_port, headless=args.headless, account=args.account):
        print("[chrome_launcher] Chrome is ready for CDP connections.")
    else:
        print("[chrome_launcher] Failed to start Chrome.", file=sys.stderr)
        sys.exit(1)
