---
summary: "macOS support matrix for native npm installs, Gateway host mode, LaunchAgent startup, and Apple-local capabilities"
read_when:
  - Installing CrawClaw on macOS
  - Defining macOS support scope
  - Looking for macOS app and Apple-local capability boundaries
title: "macOS"
---

# macOS

CrawClaw supports **native macOS** for Gateway host use. The macOS product
boundary is the CLI, Gateway, web UI, plugins, install/runtime setup, and
per-user LaunchAgent startup on the Mac.

Native macOS support does **not** mean every Apple-local integration is covered
by the npm install smoke. Apple-local features depend on host permissions,
signing, app distribution, or a separate bridge service when the feature needs
one.

## Native capability states

The macOS matrix uses three support states:

- `supported`: CrawClaw owns the native macOS path and validates it with
  automated or smoke-backed gates.
- `app-backed`: CrawClaw can use the capability through the macOS app or a
  signed Apple-local runtime, with separate app validation requirements.
- `external`: the capability depends on another local service, account, or
  provider outside the npm package itself.

## Native capability matrix

| Surface                             | Status       | macOS boundary                                                                                     |
| ----------------------------------- | ------------ | -------------------------------------------------------------------------------------------------- |
| npm installer                       | `supported`  | `npm install -g crawclaw@latest` installs the CLI package and runs install-time runtime setup.     |
| CLI                                 | `supported`  | Commands run under Node 22.14+ with macOS path, shell, and process handling.                       |
| Gateway foreground                  | `supported`  | `crawclaw gateway run` starts the Gateway directly on the Mac.                                     |
| Gateway service                     | `supported`  | Per-user LaunchAgent startup is the native service path.                                           |
| Web UI                              | `supported`  | Served by the Gateway after local or remote access is configured.                                  |
| Browser automation                  | `supported`  | Supported through Chrome-family discovery and the install-time browser runtime.                    |
| Common provider plugins             | `supported`  | Node-based providers load through the bundled plugin runtime and install-time dependency setup.    |
| macOS companion app                 | `app-backed` | The app owns app-local UX and permission-sensitive local capabilities; it has separate app gates.  |
| iMessage and Apple-local messaging  | `external`   | Requires Apple-local services, credentials, and permissions; npm install alone is not sufficient.  |
| Camera, microphone, and screen APIs | `app-backed` | Permission-sensitive APIs depend on macOS TCC prompts, signing, and the app or node host boundary. |

## Install

Install from npm:

```bash
npm install -g crawclaw@latest
```

Verify the install:

```bash
crawclaw --version
crawclaw plugins list --json
```

For guided setup:

```bash
crawclaw onboard --install-daemon
```

## Gateway references

Run the Gateway in the foreground:

```bash
crawclaw gateway run
```

Install managed startup:

```bash
crawclaw gateway install
crawclaw gateway status --json
```

macOS managed startup uses a per-user LaunchAgent. It is not a system daemon
that runs before any user logs in.

## Compatibility gate

The repo keeps a focused macOS npm install smoke in CI:

```bash
node scripts/ci/macos-packed-install-smoke.mjs
```

This gate packs the current checkout, installs it into a temporary global npm
prefix, verifies the CLI, checks bundled plugin runtime dependencies, validates
the install-time runtime manifest, lists plugins, and starts a foreground
Gateway on a temporary loopback port.

Full VM validation remains separate:

```bash
pnpm test:parallels:macos
pnpm test:parallels:npm-update
```

## Current boundaries

- The npm smoke covers CLI, plugin runtime setup, and foreground Gateway startup.
  It does not validate the macOS app release, notarization, or TCC permission
  prompts.
- LaunchAgent behavior is the native managed-startup path, but app-managed
  Gateway restarts and app permission flows still need app-specific validation.
- Apple-local integrations can require local services, Apple accounts, or
  device permissions outside CrawClaw's npm package.

## Related

- [Platforms](/platforms)
- [Gateway runbook](/gateway)
- [Install updates](/install/updating)
- [macOS VMs](/install/macos-vm)
