---
summary: "macOS support matrix for CrawClaw Desktop, Gateway host mode, desktop runtime startup, and Apple-local capabilities"
read_when:
  - Installing CrawClaw on macOS
  - Defining macOS support scope
  - Looking for Apple-local capability boundaries
title: "macOS"
---

# macOS

CrawClaw supports **native macOS** for Gateway host use. The macOS product
boundary is CrawClaw Desktop, the local Gateway, plugins, install/runtime setup,
and desktop runtime startup on the Mac.

Native macOS support does **not** mean every Apple-local integration is covered
by the npm install smoke. Apple-local features depend on host permissions,
signing, or a separate bridge service when the feature needs
one.

## Native capability states

The macOS matrix uses two support states:

- `supported`: CrawClaw owns the native macOS path and validates it with
  automated or smoke-backed gates.
- `external`: the capability depends on another local service, account, or
  provider outside the npm package itself.

## Native capability matrix

| Surface                             | Status      | macOS boundary                                                                                    |
| ----------------------------------- | ----------- | ------------------------------------------------------------------------------------------------- |
| Desktop installer                   | `supported` | GitHub Releases desktop assets install the app package and embedded runtime setup.                |
| Gateway automation API              | `supported` | Automation clients call the desktop-managed local Gateway API.                                    |
| Gateway foreground                  | `supported` | CrawClaw Desktop or the local Gateway API starts the Gateway directly on the Mac.                 |
| Gateway runtime                     | `supported` | CrawClaw Desktop owns the local Rust Gateway lifecycle.                                           |
| Browser automation                  | `supported` | Supported through Chrome-family discovery and the install-time browser runtime.                   |
| Common provider plugins             | `supported` | Provider catalog and transports are Rust-owned; bundled defaults use native runtime resources.    |
| Weixin and Apple-local messaging    | `external`  | Requires Apple-local services, credentials, and permissions; npm install alone is not sufficient. |
| Camera, microphone, and screen APIs | `external`  | Permission-sensitive APIs depend on macOS TCC prompts, signing, and a separate local runtime.     |

## Install

Install CrawClaw Desktop from [GitHub Releases](https://github.com/qianleigood/crawclaw/releases).

Verify the install:

Open CrawClaw Desktop and confirm the Gateway status is healthy. Automation
clients can verify the same install by calling the local Gateway API `health`
or `status` methods on the desktop-managed loopback Gateway.

For guided setup:

Use CrawClaw Desktop settings for models, plugins, channels, automation
environment, and launch-at-login controls. Scripted setup should patch the
same state through typed Gateway RPCs such as `config.patch`, `models.list`,
`usage.status`, `channels.status`, and `channels.config.patch`.

## Gateway references

Run the Gateway in the foreground:

Start CrawClaw Desktop and keep the app running; Desktop owns the local Gateway
lifecycle on macOS. Protocol clients should connect to the loopback Gateway and
use `status` to confirm the active process instead of starting a second
ad-hoc Gateway.

Install managed startup:

Enable launch at login from CrawClaw Desktop settings. When debugging startup,
inspect the per-user launchd state with `launchctl print gui/$UID | grep crawclaw`,
then use Desktop to restart the app-managed Gateway.

macOS managed startup uses a per-user LaunchAgent. It is not a system daemon
that runs before any user logs in.

## Compatibility gate

The repo keeps a focused macOS npm install smoke in CI:

```bash
pnpm desktop:tauri:release-check
```

This gate packs the current checkout, installs it into a temporary global npm
prefix, verifies the CLI, checks bundled plugin dependency staging, validates
the install-time native runtime manifest, lists plugins, and starts a foreground
Gateway on a temporary loopback port.

Full VM validation remains separate:

```bash
pnpm desktop:tauri:release-check
pnpm desktop:tauri:release-check
```

## Current boundaries

- The npm smoke covers CLI, native runtime setup, and foreground Gateway startup.
  It does not validate notarization or TCC permission prompts.
- LaunchAgent behavior is the native managed-startup path.
- Apple-local integrations can require local services, Apple accounts, or
  device permissions outside CrawClaw's npm package.

## Related

- [Platforms](/platforms)
- [Gateway runbook](/gateway)
- [Install updates](/install/updating)
- [macOS VMs](/install/macos-vm)
