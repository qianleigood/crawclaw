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
WSL2 remains the lowest-risk path because the CLI, Gateway, shell tools, and
Linux-oriented automation run in a Linux environment. Native Windows is treated
as a first-class CLI and Gateway host target, with the support boundary below.

Native Windows support does not mean feature parity with Apple-only local
integrations. It means the Windows host can install CrawClaw, run the CLI, run
the Gateway, manage startup, load supported plugins, and pass the Windows
compatibility gates without requiring WSL2.

## Support matrix

| Surface                  | Native Windows target                                                                                                     | Status                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Installer                | `install.ps1` installs Node 22+, Git when needed, CrawClaw via npm or git, and optional onboarding.                       | Supported                              |
| CLI                      | Commands run from PowerShell with Windows-safe argument, path, shell, and process-spawn handling.                         | Supported                              |
| Gateway foreground       | `crawclaw gateway run` starts the Gateway directly on the Windows host.                                                   | Supported                              |
| Gateway auto-start       | `crawclaw gateway install` uses Windows Scheduled Tasks when allowed, then falls back to a per-user Startup-folder entry. | Supported with caveats                 |
| Providers and plugins    | Node-based plugins load through the bundled plugin runtime and install-time dependency setup.                             | Supported with plugin-specific caveats |
| Browser automation       | Chrome and Edge discovery plus Playwright-backed browser plugins are validated by compatibility tests.                    | Supported with caveats                 |
| Docker sandbox           | Requires Docker Desktop or another working Windows Docker engine.                                                         | Limited                                |
| WSL2 Gateway host        | Linux install path inside WSL2 with systemd user service support.                                                         | Recommended                            |
| Apple-local integrations | iMessage and BlueBubbles depend on Apple devices or bridge hosts.                                                         | Not native Windows                     |
| Native companion app     | Windows tray or desktop companion shell.                                                                                  | Not shipped                            |

## Choose a path

Use **WSL2** when you want the broadest compatibility, Linux shell tooling, or
Docker-heavy workflows.

Use **native Windows** when you want CrawClaw installed and managed directly in
Windows, can run PowerShell, and do not need Apple-local integrations on that
host.

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
Startup-folder login item and starts the Gateway immediately. Scheduled Tasks
remain preferred because they provide better supervisor status and restart
visibility.

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

## Acceptance criteria

Native Windows support is considered healthy when all of these are true:

- `install.ps1` can install or update CrawClaw without manual Node or Git setup
  on a supported Windows machine.
- `crawclaw --version`, `crawclaw doctor --non-interactive`, and
  `crawclaw plugins list --json` work in a fresh PowerShell session.
- `crawclaw gateway run` starts the Gateway in the foreground.
- `crawclaw gateway install` either creates a Scheduled Task or installs the
  documented Startup-folder fallback without hanging.
- Provider and channel plugins that declare Windows support install their
  runtime dependencies during install or postinstall, not lazily during the
  first user request.
- `pnpm test:windows:compat` passes locally, and the Parallels Windows smoke
  gate passes before treating native Windows changes as release-ready.

## Current caveats

- `crawclaw onboard --non-interactive` expects a reachable local Gateway unless
  you pass `--skip-health`.
- Windows service status is best with Scheduled Tasks. Startup-folder fallback
  mode is intentionally simpler and only starts after user login.
- Docker sandbox support depends on the user's Windows Docker installation.
- Some plugins may require additional native binaries or browser/runtime
  dependencies that are installed outside CrawClaw.
- Apple-local integrations require an Apple device or bridge host and are not
  native Windows capabilities.

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
