---
summary: "Install and operate CrawClaw Desktop, the local-first desktop app"
read_when:
  - You want the default local desktop entrypoint for CrawClaw
  - You need to know what the desktop app bundles and starts
  - You are validating platform support or release assets
title: "Desktop"
---

# Desktop

CrawClaw Desktop is the default local app for CrawClaw on macOS, Windows, and Linux. It reuses the Vue admin UI and local Node backend, but the product boundary is local-first: the desktop app bundles the CrawClaw runtime, initializes `~/.crawclaw`, installs or refreshes the local Gateway service, starts that service, then opens the admin UI against the local Gateway.

The CLI, headless, Docker, and server flows remain supported for advanced and server deployments. They are no longer the primary desktop user flow.

## Trust model

CrawClaw Desktop is a local admin console for the current machine. It can expose the same host-level capabilities as the admin backend, including file browsing, terminal sessions, backups, system metrics, and supported remote desktop controls.

The Electron host keeps the browser window on the local backend origin and exposes only a small preload bridge for host-owned actions such as opening external links. Ordinary admin actions still go through the local backend HTTP and SSE surface.

The backend runs in desktop mode with these constraints:

- It binds to loopback only.
- It uses a random local port selected by the desktop host.
- It stores mutable state outside the app bundle.
- It connects only to the local Gateway managed by the desktop runtime.
- It disables npm global self-update behavior and points users to GitHub Releases for desktop updates.

## Bundled runtime

Desktop packages include the production CrawClaw runtime under the app resources directory:

```text
runtime/crawclaw/crawclaw.mjs
runtime/crawclaw/node_modules/
```

The packaged app uses this embedded runtime for service install, service start, status checks, and log reads. End users do not need a globally installed `crawclaw` binary or a preconfigured shell `PATH` for the desktop flow.

## Supported platforms

Desktop release assets are built for:

| Platform | Target artifact  |
| -------- | ---------------- |
| macOS    | `dmg` and `zip`  |
| Windows  | `nsis` installer |
| Linux    | `AppImage`       |

Platform-sensitive features may still differ by OS. The app queries `/api/desktop/capabilities` and disables unsupported actions with the backend-provided reason instead of hiding the route entirely.

## Gateway service

On first launch, CrawClaw Desktop prepares the local runtime state in `~/.crawclaw` and writes missing local defaults:

- `gateway.mode=local`
- loopback binding
- the default local Gateway port
- online reconfigure behavior
- local authentication material for the desktop Gateway

The desktop app installs or refreshes the OS user service through the existing launchd, systemd, or Windows service path. The installed command points at the embedded runtime entrypoint instead of a global `crawclaw` command.

Closing the desktop window hides the UI and keeps the Gateway service running. Quitting the desktop app exits the Electron UI and local admin backend, but it does not stop the Gateway. Use the Gateway Service controls in Settings to explicitly start, stop, restart, or inspect logs.

## State locations

Runtime state is shared with the CLI under:

```text
~/.crawclaw
```

Electron `userData` stores only desktop UI and admin backend state. The layout is:

```text
config.json
admin.env
data/
backups/
logs/
```

The admin backend receives these paths through `CRAWCLAW_ADMIN_*` environment variables and writes SQLite data, backups, and logs under the desktop state directory instead of the installed application bundle.

## Gateway connection

CrawClaw Desktop connects to the local Gateway using:

```text
ws://127.0.0.1:18789
```

Remote Gateway, VPS, and headless server deployments are managed through the CLI and server install documentation instead of the desktop UI.

## Updates

Desktop builds update as a single desktop package: the app, embedded CrawClaw runtime, local admin backend, and UI are delivered together. The desktop UI does not call the CLI npm self-update path.

When a desktop update is available, install the platform asset from [GitHub Releases](https://github.com/qianleigood/crawclaw/releases).

## Beta limitations

- Automatic desktop update downloads are not included in this pass.
- Store distribution is not included.
- Remote desktop parity is not guaranteed across all platforms.
- Signing and notarization depend on the release workflow inputs and maintainer credentials.

## Build from source

For local packaging work:

```bash
pnpm admin:build
pnpm admin:desktop:build
pnpm admin:desktop:pack
```

For release validation:

```bash
pnpm admin:desktop:release-check
```

See [Updating](/install/updating) for the CLI and server update flow. Desktop app updates are handled through GitHub Releases.
