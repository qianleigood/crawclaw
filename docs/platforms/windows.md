---
summary: "Windows support matrix for native and WSL2 installs, Gateway service mode, plugins, and validation gates"
read_when:
  - Installing CrawClaw on Windows
  - Choosing between native Windows and WSL2
  - Defining native Windows support scope
  - Looking for Windows companion app status
title: "Windows"
---

# Windows

CrawClaw supports both **native Windows** and **WSL2** for Gateway host use.
WSL2 remains the lowest-risk path for Linux-oriented automation and Docker-heavy
workflows because the CLI, Gateway, shell tools, and service manager run in a
Linux environment. Native Windows is a first-class CLI and Gateway host target
inside the product boundary below.

Native Windows support does **not** mean full parity with macOS-only local
integrations or every Linux sandbox behavior. It means the Windows host can
install CrawClaw, run the CLI, run the Gateway, manage per-user startup, load
supported plugins, and pass the Windows compatibility gates without requiring
WSL2.

## Native capability states

The Windows matrix uses three support states:

- `supported`: CrawClaw owns the native Windows path and validates it with
  automated or smoke-backed gates.
- `bridged`: CrawClaw can use the capability from Windows, but the native
  capability runs on another host such as a Mac or headless node.
- `not-native`: the capability is outside the current native Windows product
  boundary.

## Native capability matrix

| Surface                              | Status       | Windows boundary                                                                                                      |
| ------------------------------------ | ------------ | --------------------------------------------------------------------------------------------------------------------- |
| Installer                            | `supported`  | `install.ps1` installs Node 24 by default, accepts Node 22.14+, checks Git/PATH prerequisites, and installs CrawClaw. |
| CLI                                  | `supported`  | Commands run from PowerShell with Windows-safe argument, path, shell, and process-spawn handling.                     |
| Gateway foreground                   | `supported`  | `crawclaw gateway run` starts the Gateway directly on the Windows host.                                               |
| Gateway service                      | `supported`  | Per-user login service: Scheduled Task when allowed, Startup-folder fallback when task creation is denied.            |
| `exec` and `system.run` tools        | `supported`  | PowerShell 7 is preferred with Windows PowerShell fallback; command shims must avoid unsafe shell fallbacks.          |
| Browser automation                   | `supported`  | Supported after Windows smoke coverage for Chrome/Edge/Brave discovery and the browser runtime.                       |
| Docker sandbox                       | `supported`  | Supported after Windows drive-path, Docker Desktop bind, and sandbox security gates pass.                             |
| Telegram, Discord, Slack, Matrix     | `supported`  | Supported through built-in or bundled channel/plugin paths, with smoke coverage where provider credentials permit.    |
| Common provider plugins              | `supported`  | Node-based providers load through the bundled plugin runtime and install-time dependency setup.                       |
| BlueBubbles and iMessage             | `bridged`    | Bridged through a Mac server or Apple host; Windows runs the Gateway/client side, not Apple's local messaging stack.  |
| Apple skills and macOS-only tooling  | `bridged`    | Bridged through a Mac or headless node that owns the Apple-local runtime and permissions.                             |
| WSL2 Gateway host                    | `supported`  | Linux install path inside WSL2 with systemd user service support; still recommended for broad Linux compatibility.    |
| macOS companion app                  | `not-native` | Not described as a native Windows deliverable in this repo.                                                           |
| Windows tray or desktop companion UI | `not-native` | Not shipped today; native Windows support is CLI, Gateway, web UI, plugins, and runtime setup.                        |

## Choose a path

Use **WSL2** when you want the broadest Linux compatibility, Linux shell
tooling, or Docker-heavy workflows.

Use **native Windows** when you want CrawClaw installed and managed directly in
Windows, can run PowerShell, and do not need Apple-local integrations to execute
on that host.

## Native install

Run PowerShell as your normal user:

```powershell
iwr -useb https://crawclaw.ai/install.ps1 | iex
```

For a dry run or beta install:

```powershell
& ([scriptblock]::Create((iwr -useb https://crawclaw.ai/install.ps1))) -DryRun
& ([scriptblock]::Create((iwr -useb https://crawclaw.ai/install.ps1))) -Tag beta
```

Verify the install:

```powershell
crawclaw --version
crawclaw doctor --non-interactive
crawclaw plugins list --json
```

If PowerShell cannot find `crawclaw` in a new terminal, see
[Node.js troubleshooting](/install/node#troubleshooting).

## Native Gateway

Run the Gateway in the foreground:

```powershell
crawclaw gateway run
```

Install managed startup:

```powershell
crawclaw gateway install
crawclaw gateway status --json
```

If Scheduled Task creation is denied, CrawClaw falls back to a per-user
Startup-folder login item and starts the Gateway immediately. This is a
per-user login service, not a machine service that runs before any user logs in.
Scheduled Tasks remain preferred because they provide better supervisor status
and restart visibility.

For CLI-only setups, skip health-gated onboarding:

```powershell
crawclaw onboard --non-interactive --skip-health
```

## Native compatibility gate

The repo keeps a focused Windows compatibility gate for code paths that can be
validated from any development host:

```bash
pnpm test:windows:compat
```

This gate covers installer wrapper regressions, Windows process spawning,
PowerShell shell selection, path normalization, Scheduled Task fallback
behavior, startup fallback handling, Docker invocation shaping, browser
executable discovery, and plugin runtime spawn helpers.

Full native validation still requires a Windows VM or host:

```bash
pnpm test:parallels:windows
pnpm test:parallels:npm-update
```

## Native first-class acceptance criteria

Native Windows can be described as first-class when all of these are true:

- `install.ps1` can install or update CrawClaw without manual Node or Git setup
  on a clean supported Windows 11 machine.
- `crawclaw --version` works in a fresh PowerShell session without manually
  repairing PATH.
- `crawclaw doctor --non-interactive` has no blocking errors.
- `crawclaw onboard --non-interactive --install-daemon` completes for a local
  Gateway setup.
- `crawclaw gateway status --deep --require-rpc` reports a reachable Gateway.
- `crawclaw agent --local --agent main --message "Reply OK only." --json`
  completes a first local turn.
- Browser runtime checks either pass or return a clear, actionable repair
  instruction.
- Provider and channel plugins that declare Windows support install their
  runtime dependencies during install or postinstall, not lazily during the
  first user request.
- Upgrade from the published `latest` package to the current package succeeds.
- CI and release gates cover the Windows install, postinstall manifest,
  Gateway lifecycle, first agent turn, and smoke-backed runtime checks.

## Current boundaries

- Gateway auto-start is a per-user login mode. Running before any Windows user
  signs in would require an administrator-installed Windows Service and is a
  later phase.
- Docker sandbox support depends on Docker Desktop or another working Windows
  Docker engine plus passing Windows path and sandbox security checks.
- Some plugins may require provider credentials, native binaries, browser
  installs, or runtime dependencies outside CrawClaw's package.
- Apple-local integrations require an Apple device or bridge host and are
  `bridged`, not native Windows capabilities.
- Native Windows support should not be described as full Windows parity until
  the gates in this document are green in CI, nightly, and release validation.

## WSL2 (recommended)

- [Getting Started](/start/getting-started) (use inside WSL)
- [Install & updates](/install/updating)
- Official WSL2 guide (Microsoft): [https://learn.microsoft.com/windows/wsl/install](https://learn.microsoft.com/windows/wsl/install)

## Gateway

- [Gateway runbook](/gateway)
- [Configuration](/gateway/configuration)

## Gateway service install (CLI)

Inside WSL2:

```
crawclaw onboard --install-daemon
```

Or:

```
crawclaw gateway install
```

Or:

```
crawclaw configure
```

Select **Gateway service** when prompted.

Repair/migrate:

```
crawclaw doctor
```

## Gateway auto-start before Windows login

For headless setups, ensure the full boot chain runs even when no one logs into
Windows.

### 1) Keep user services running without login

Inside WSL:

```bash
sudo loginctl enable-linger "$(whoami)"
```

### 2) Install the CrawClaw gateway user service

Inside WSL:

```bash
crawclaw gateway install
```

### 3) Start WSL automatically at Windows boot

In PowerShell as Administrator:

```powershell
schtasks /create /tn "WSL Boot" /tr "wsl.exe -d Ubuntu --exec /bin/true" /sc onstart /ru SYSTEM
```

Replace `Ubuntu` with your distro name from:

```powershell
wsl --list --verbose
```

### Verify startup chain

After a reboot (before Windows sign-in), check from WSL:

```bash
systemctl --user is-enabled crawclaw-gateway
systemctl --user status crawclaw-gateway --no-pager
```

## Advanced: expose WSL services over LAN (portproxy)

WSL has its own virtual network. If another machine needs to reach a service
running **inside WSL** (SSH, a local TTS server, or the Gateway), you must
forward a Windows port to the current WSL IP. The WSL IP changes after restarts,
so you may need to refresh the forwarding rule.

Example (PowerShell **as Administrator**):

```powershell
$Distro = "Ubuntu-24.04"
$ListenPort = 2222
$TargetPort = 22

$WslIp = (wsl -d $Distro -- hostname -I).Trim().Split(" ")[0]
if (-not $WslIp) { throw "WSL IP not found." }

netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=$ListenPort `
  connectaddress=$WslIp connectport=$TargetPort
```

Allow the port through Windows Firewall (one-time):

```powershell
New-NetFirewallRule -DisplayName "WSL SSH $ListenPort" -Direction Inbound `
  -Protocol TCP -LocalPort $ListenPort -Action Allow
```

Refresh the portproxy after WSL restarts:

```powershell
netsh interface portproxy delete v4tov4 listenport=$ListenPort listenaddress=0.0.0.0 | Out-Null
netsh interface portproxy add v4tov4 listenport=$ListenPort listenaddress=0.0.0.0 `
  connectaddress=$WslIp connectport=$TargetPort | Out-Null
```

Notes:

- SSH from another machine targets the **Windows host IP** (example: `ssh user@windows-host -p 2222`).
- Remote nodes must point at a **reachable** Gateway URL (not `127.0.0.1`); use
  `crawclaw status --all` to confirm.
- Use `listenaddress=0.0.0.0` for LAN access; `127.0.0.1` keeps it local only.
- If you want this automatic, register a Scheduled Task to run the refresh
  step at login.

## Step-by-step WSL2 install

### 1) Install WSL2 + Ubuntu

Open PowerShell (Admin):

```powershell
wsl --install
# Or pick a distro explicitly:
wsl --list --online
wsl --install -d Ubuntu-24.04
```

Reboot if Windows asks.

### 2) Enable systemd (required for gateway install)

In your WSL terminal:

```bash
sudo tee /etc/wsl.conf >/dev/null <<'EOF'
[boot]
systemd=true
EOF
```

Then from PowerShell:

```powershell
wsl --shutdown
```

Re-open Ubuntu, then verify:

```bash
systemctl --user status
```

### 3) Install CrawClaw (inside WSL)

Follow the Linux Getting Started flow inside WSL:

```bash
git clone https://github.com/qianleigood/crawclaw.git
cd crawclaw
pnpm install
pnpm build
crawclaw onboard
```

Full guide: [Getting Started](/start/getting-started)

## Windows companion app

There is no Windows companion app today. The supported Windows surface is the
CLI, Gateway, web UI, plugins, and install/runtime path described on this page.

## Related pages

- [Installer internals](/install/installer)
- [Node.js install and troubleshooting](/install/node)
- [Gateway runbook](/gateway)
- [Gateway configuration](/gateway/configuration)
