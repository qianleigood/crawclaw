---
summary: "Windows support matrix for native installs, Gateway runtime mode, plugins, and validation gates"
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
install CrawClaw, run the CLI, run the Gateway, manage per-user startup, load
supported plugins, and pass the Windows compatibility gates without requiring
Linux compatibility layers.

## Native capability states

The Windows matrix uses three support states:

- `supported`: CrawClaw owns the native Windows path and validates it with
  automated or smoke-backed gates.
- `not-native`: the capability is outside the current native Windows product
  boundary.

## Native capability matrix

| Surface                             | Status       | Windows boundary                                                                                                                                            |
| ----------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installer                           | `supported`  | `CrawClaw Desktop installer` installs Node 24 by default, accepts Node 25 as an experimental runtime, checks Git/PATH prerequisites, and installs CrawClaw. |
| CLI                                 | `supported`  | Commands run from PowerShell with Windows-safe argument, path, shell, and process-spawn handling.                                                           |
| Gateway foreground                  | `supported`  | CrawClaw Desktop or the local Gateway API starts the Gateway directly on the Windows host.                                                                  |
| Gateway runtime                     | `supported`  | CrawClaw Desktop or the local Gateway API starts the local Rust Gateway directly on the Windows host.                                                       |
| `exec` and `system.run` tools       | `supported`  | PowerShell 7 is preferred with Windows PowerShell fallback; command shims must avoid unsafe shell fallbacks.                                                |
| Browser automation                  | `supported`  | Supported after Windows smoke coverage for Chrome/Edge/Brave discovery and the browser runtime.                                                             |
| Feishu, QQBot, DingTalk, Weixin     | `supported`  | Supported through built-in or bundled channel/plugin paths, with smoke coverage where provider credentials permit.                                          |
| Common provider plugins             | `supported`  | Provider catalog and transports are Rust-owned; bundled defaults use native runtime resources.                                                              |
| legacy messaging and Weixin         | `not-native` | Requires a Mac-side legacy messaging or Apple messaging host outside the Windows runtime.                                                                   |
| Apple skills and macOS-only tooling | `not-native` | Requires an Apple host outside the Windows runtime.                                                                                                         |

## Install

Run PowerShell as your normal user:

```powershell
# Install CrawClaw Desktop from GitHub Releases.
```

For a dry run or beta install:

```powershell
# Install CrawClaw Desktop from GitHub Releases.
# Install CrawClaw Desktop from GitHub Releases.
```

Verify the install:

```powershell
# Use CrawClaw Desktop or the local Gateway API for this operation.
# Use CrawClaw Desktop or the local Gateway API for this operation.
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

Desktop users do not need a global `crawclaw` command. Use CrawClaw Desktop or the local Gateway API for operator actions.

## Gateway references

Run the Gateway in the foreground:

```powershell
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

Managed OS startup is not part of the default desktop runtime path. Use
CrawClaw Desktop or the local Gateway API to start the local Rust Gateway.

For Gateway API-only setups, skip health-gated onboarding:

```powershell
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

## Compatibility Gate

The repo keeps Windows-relevant compatibility coverage inside the native Rust
workspace gate:

```bash
pnpm test
```

This gate covers native runtime spawn helpers and cross-platform path/process
behavior that can be validated from any development host.

Full native validation still requires a Windows VM or host:

```bash
pnpm desktop:tauri:release-check
pnpm desktop:tauri:release-check
```

## First-class acceptance criteria

Native Windows can be described as first-class when all of these are true:

- `CrawClaw Desktop installer` can install or update CrawClaw without manual Node or Git setup
  on a clean supported Windows 11 machine.
- the packaged desktop version check works in a fresh PowerShell session without manually
  repairing PATH.
- CrawClaw Desktop or the local Gateway API has no blocking errors.
- CrawClaw Desktop or the local Gateway API completes for a local
  Gateway setup.
- CrawClaw Desktop or the local Gateway API reports a reachable Gateway.
- CrawClaw Desktop or the local Gateway API
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
- Some plugins may require provider credentials, native binaries, browser
  installs, or runtime dependencies outside CrawClaw's package.
- Apple-local integrations require an Apple device or bridge host and are
  `bridged`, not native Windows capabilities.
- Native Windows support should not be described as full Windows parity until
  the gates in this document are green in CI, nightly, and release validation.

## Gateway

- [Gateway runbook](/gateway)
- [Configuration](/gateway/configuration)

## Gateway runtime

Use CrawClaw Desktop or the local Gateway API. The old CLI-managed Scheduled
OS task and login-item paths have been retired from the default desktop product
path.

## Related pages

- [Desktop](/install/desktop)
- [Node.js install and troubleshooting](/install/node)
- [Gateway runbook](/gateway)
- [Gateway configuration](/gateway/configuration)
