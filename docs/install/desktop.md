---
summary: "Install and operate CrawClaw Admin Desktop, the packaged local admin console"
read_when:
  - You want the desktop packaged form of CrawClaw Admin
  - You need to know where desktop state and credentials are stored
  - You are validating platform support or release assets
title: "Desktop"
---

# Desktop

CrawClaw Admin Desktop packages the `apps/crawclaw-admin` console as a local desktop application for macOS, Windows, and Linux. It reuses the same Vue admin UI and local Node backend, then wraps them in an Electron host that starts the backend on a random loopback port and loads the UI in a desktop window.

The first beta is for operators who want a packaged local console without running the admin web server manually. It still connects to an existing CrawClaw Gateway. It does not install, start, or supervise the Gateway process for you.

## Trust model

The desktop app is a local admin console. It can expose the same host-level capabilities as the admin backend, including file browsing, terminal sessions, backups, system metrics, and supported remote desktop controls.

The Electron host keeps the browser window on the local backend origin and exposes only a small preload bridge for host-owned actions such as opening external links. Ordinary admin actions still go through the local backend HTTP and SSE surface.

The backend runs in desktop mode with these constraints:

- It binds to loopback only.
- It uses a random local port selected by the desktop host.
- It stores mutable state outside the app bundle.
- It disables npm global self-update behavior and points users to GitHub Releases for desktop updates.

## Supported platforms

Desktop release assets are built for:

| Platform | Target artifact  |
| -------- | ---------------- |
| macOS    | `dmg` and `zip`  |
| Windows  | `nsis` installer |
| Linux    | `AppImage`       |

Platform-sensitive features may still differ by OS. The app queries `/api/desktop/capabilities` and disables unsupported actions with the backend-provided reason instead of hiding the route entirely.

## Credentials

Gateway token and password values are stored through the operating system credential store. The desktop host uses the service name `CrawClaw Admin` and stores Gateway secrets under profile-scoped accounts.

Non-sensitive settings can remain in the desktop `config.json`, including:

- Active profile id.
- Gateway WebSocket URL.
- Locale.
- Theme.
- Hermes web and API endpoints.

Secrets are not written to `.env` or `config.json` in desktop mode. If the OS credential store is unavailable, the app can use a session-only in-memory fallback for the current process, but it will not persist those secrets.

## State locations

The app uses the standard Electron `userData` directory for the current platform. The layout is:

```text
config.json
admin.env
data/
backups/
logs/
runtime/
```

The admin backend receives these paths through `CRAWCLAW_ADMIN_*` environment variables and writes SQLite data, backups, and logs under that state directory instead of the installed application bundle.

## Gateway connection

CrawClaw Admin Desktop connects to a local or remote Gateway using a WebSocket URL such as:

```text
ws://localhost:18789
```

For a remote Gateway, use the reachable Gateway WebSocket URL and provide the Gateway token or password required by that deployment. The first beta supports one active profile; multiple saved profiles are planned for a later pass.

## Updates

Desktop builds do not use the CLI npm self-update path. When a desktop update is available, use the platform asset from [GitHub Releases](https://github.com/qianleigood/crawclaw/releases).

The admin UI also switches update copy in desktop mode so it links to Releases instead of calling the npm update endpoint.

## Beta limitations

- The desktop app does not install or launch CrawClaw Gateway.
- Only one active Gateway profile is supported in the first beta.
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

See [Updating](/install/updating) for the CLI and Gateway update flow. Desktop app updates are handled through GitHub Releases.
