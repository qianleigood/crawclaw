---
summary: "Install and operate CrawClaw Desktop, the local desktop client"
read_when:
  - You want CrawClaw as a desktop client
  - You need to know where desktop state and local Gateway state are stored
  - You are validating platform support or release assets
title: "Desktop"
---

# Desktop

CrawClaw Desktop is the default local app experience for macOS, Windows, and Linux. It packages the Vue Admin UI, the local Admin backend, and a bundled CrawClaw runtime into one Electron app.

On first launch, the desktop host initializes the local `~/.crawclaw/crawclaw.json`, starts the Admin backend on a random loopback port, and connects the UI to the local Gateway at `127.0.0.1`. The Gateway is treated as a background service: closing the window hides the desktop UI, but it does not stop the Gateway.

## Trust model

The desktop app is a local client for your own machine. It can expose the same host-level capabilities as the admin backend, including file browsing, terminal sessions, backups, system metrics, and supported remote desktop controls.

The Electron host keeps the browser window on the local backend origin and exposes only a small preload bridge for host-owned actions such as opening external links. Ordinary admin actions still go through the local backend HTTP and SSE surface.

The backend runs in desktop mode with these constraints:

- It binds to loopback only.
- It uses a random local port selected by the desktop host.
- It only connects to the local CrawClaw Gateway in desktop-local mode.
- It stores desktop UI state outside the app bundle.
- It stores Gateway runtime state in `~/.crawclaw`.
- It disables npm global self-update behavior and points users to desktop release assets.

## Supported platforms

Desktop release assets are built for:

| Platform | Target artifact  |
| -------- | ---------------- |
| macOS    | `dmg` and `zip`  |
| Windows  | `nsis` installer |
| Linux    | `AppImage`       |

Platform-sensitive features may still differ by OS. The app queries `/api/desktop/capabilities` and disables unsupported actions with the backend-provided reason instead of hiding the route entirely.

## Local Gateway

CrawClaw Desktop writes or repairs the minimum local Gateway defaults without overwriting existing user choices:

- `gateway.mode=local`
- `gateway.bind=loopback`
- `gateway.port=18789` when no port exists yet
- `gateway.reload.mode=hybrid`
- token auth when no Gateway auth mode is configured yet

The Admin backend receives the local WebSocket URL and token from the desktop bootstrap path. The frontend does not store or edit the Gateway secret directly.

Remote Gateway profiles and Hermes switching are not part of CrawClaw Desktop. Use the CLI or a web Admin deployment when you need to administer a remote or headless Gateway.

## State locations

The app uses the standard Electron `userData` directory for desktop UI state:

```text
config.json
admin.env
data/
backups/
logs/
```

The admin backend receives these paths through `CRAWCLAW_ADMIN_*` environment variables and writes SQLite data, backups, and logs under that state directory instead of the installed application bundle.

The CrawClaw runtime state remains in:

```text
~/.crawclaw/
```

The bundled runtime is packaged under the application resources at `runtime/crawclaw` and is used for desktop service commands. Desktop service controls must not depend on a global `crawclaw` command in `PATH`.

## Updates

Desktop builds update the app and bundled Gateway runtime together. When a desktop update is available, use the platform asset from [GitHub Releases](https://github.com/qianleigood/crawclaw/releases).

The admin UI also switches update copy in desktop mode so it links to Releases instead of calling the npm update endpoint.

## Current limitations

- Automatic desktop update downloads are not included in this pass.
- Store distribution is not included.
- Remote desktop parity is not guaranteed across all platforms.
- Signing and notarization depend on the release workflow inputs and maintainer credentials.

## Build from source

For local packaging work:

```bash
pnpm admin:build
pnpm admin:desktop:build
pnpm admin:desktop:stage-runtime
pnpm admin:desktop:pack
```

For release validation:

```bash
pnpm admin:desktop:release-check
```

See [Updating](/install/updating) for the CLI and Gateway update flow. Desktop app updates are handled through GitHub Releases.
