---
summary: "Windows support matrix for native installs, Gateway service mode, plugins, and validation gates"
read_when:
  - Installing CrawClaw on Windows
  - Defining Windows support scope
title: "Windows"
---

# Windows

CrawClaw supports **native Windows** for Gateway host use. The Windows product
boundary is the CLI, Gateway, plugins, install/runtime setup, and
per-user startup on the Windows host.

Native Windows support does **not** mean full parity with macOS-only local
integrations or every Linux sandbox behavior. It means the Windows host can
install CrawClaw, run the CLI, run the Gateway, manage per-user startup, load
supported plugins, and pass the Windows compatibility gates without requiring
Linux compatibility layers.

## Native capability states

The Windows matrix uses three support states:

- `supported`: CrawClaw owns the native Windows path and validates it with
  automated or smoke-backed gates.
- `bridged`: CrawClaw can use the capability from Windows, but the native
  capability runs on another host such as a Mac or headless node.
- `not-native`: the capability is outside the current native Windows product
  boundary.

## Native capability matrix

| Surface                             | Status      | Windows boundary                                                                                                      |
| ----------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------- |
| Installer                           | `supported` | `install.ps1` installs Node 24 by default, accepts Node 22.14+, checks Git/PATH prerequisites, and installs CrawClaw. |
| CLI                                 | `supported` | Commands run from PowerShell with Windows-safe argument, path, shell, and process-spawn handling.                     |
| Gateway foreground                  | `supported` | `crawclaw gateway run` starts the Gateway directly on the Windows host.                                               |
| Gateway service                     | `supported` | Per-user login service: Scheduled Task when allowed, Startup-folder fallback when task creation is denied.            |
| `exec` and `system.run` tools       | `supported` | PowerShell 7 is preferred with Windows PowerShell fallback; command shims must avoid unsafe shell fallbacks.          |
| Browser automation                  | `supported` | Supported after Windows smoke coverage for Chrome/Edge/Brave discovery and the browser runtime.                       |
| Docker sandbox                      | `supported` | Supported after Windows drive-path, Docker Desktop bind, and sandbox security gates pass.                             |
| Telegram, Discord, Slack, Matrix    | `supported` | Supported through built-in or bundled channel/plugin paths, with smoke coverage where provider credentials permit.    |
| Common provider plugins             | `supported` | Node-based providers load through the bundled plugin runtime and install-time dependency setup.                       |
| BlueBubbles and iMessage            | `bridged`   | Bridged through a Mac server or Apple host; Windows runs the Gateway/client side, not Apple's local messaging stack.  |
| Apple skills and macOS-only tooling | `bridged`   | Bridged through a Mac or headless node that owns the Apple-local runtime and permissions.                             |

## Install

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

## Gateway references

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

## Compatibility gate

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

## First-class acceptance criteria

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

## Gateway

- [Gateway runbook](/gateway)
- [Configuration](/gateway/configuration)

## Gateway service install (CLI)

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

## Related pages

- [Installer internals](/install/installer)
- [Node.js install and troubleshooting](/install/node)
- [Gateway runbook](/gateway)
- [Gateway configuration](/gateway/configuration)
