---
title: "CrawClaw Admin Desktop Design"
summary: "Design for packaging the tracked CrawClaw Admin console as a cross-platform desktop application"
read_when:
  - You are implementing the desktop wrapper for apps/crawclaw-admin
  - You need the runtime, packaging, security, and release plan for CrawClaw Admin Desktop
---

# CrawClaw Admin Desktop Design

## Summary

CrawClaw should ship `apps/crawclaw-admin` as a cross-platform desktop
application by adding an Electron host around the existing admin frontend and
Node backend. The goal is not to rewrite the admin console. The first desktop
release should productize the current local web console: start a local admin
backend, load the existing built UI in a desktop window, store sensitive
settings in the operating system credential store, and publish signed or
verifiable installers for macOS, Windows, and Linux.

The current admin app is already close to a local desktop product. It has a Vue
3 frontend, an Express backend, Gateway RPC access, file browsing and editing,
PTY terminal support, Hermes CLI sessions, backup and restore flows, ComfyUI
output downloads, system metrics, and experimental remote desktop support. The
desktop work should keep those capabilities inside the existing admin package
where practical, while moving launch, storage, credentials, update, and
platform integration into a new desktop host package.

Electron is the recommended host because the existing admin backend already
depends on Node and native Node modules such as `node-pty` and
`better-sqlite3`. Tauri with a Node sidecar remains possible, but it would add
more process, native-module, and update complexity before the product shape is
stable.

## Goals

- Ship installable desktop builds for macOS, Windows, and Linux.
- Reuse the tracked Vue admin app under `apps/crawclaw-admin`.
- Reuse the existing admin backend instead of replacing it with a new native
  service.
- Start and stop the admin backend from the desktop host.
- Bind the admin backend to `127.0.0.1` on a random local port in desktop mode.
- Store desktop state outside the source or application bundle directory.
- Store Gateway tokens, Gateway passwords, and external API keys in the OS
  credential store.
- Keep the desktop app usable against both local and remote Gateways.
- Replace the admin web app's npm update action with desktop update behavior.
- Publish release assets through GitHub Releases with platform-specific
  validation.

## Non-Goals

- Do not rewrite `apps/crawclaw-admin` in a different frontend framework.
- Do not migrate the first desktop release to Tauri.
- Do not require a system Node.js installation for end users.
- Do not embed or start the CrawClaw Gateway automatically in the first release.
- Do not make remote desktop feature parity a blocker for all platforms.
- Do not make the desktop app a privileged background daemon.
- Do not expose more filesystem or shell access than the current admin backend
  already exposes.
- Do not reuse the npm global update path for desktop app updates.

## Current Repository Fit

The tracked admin console lives under `apps/crawclaw-admin` and uses Vue 3,
Vite, Pinia, Vue Router, Vue I18n, and Naive UI. The existing backend is a Node
Express server that can serve the built frontend from `dist` when available.
This is already a good base for a desktop host because the browser window can
load a loopback URL served by the same backend.

The current backend is not only a Gateway proxy. It owns host-level behavior:

- Gateway connection and reconnection.
- Admin login and runtime configuration.
- Local file list, read, write, upload, delete, and rename operations.
- PTY terminal sessions through `node-pty`.
- Hermes CLI sessions.
- Local system metrics.
- Remote desktop capture and input on supported platforms.
- Backup, restore, upload, and download flows.
- N8n and Hermes proxy integration.
- npm version lookup and global npm update.

The desktop implementation must therefore treat the backend as the local
runtime, not as an optional development server.

## Product Shape

The desktop app should open directly into the admin workbench. It should not
show a marketing landing page, a browser-style address bar, or a separate
"server started" page. The user-facing first-run flow should be:

1. Launch CrawClaw Admin Desktop.
2. Enter or select a Gateway endpoint.
3. Provide a Gateway token or password when required.
4. Save the connection profile.
5. Open the normal admin dashboard.

The first release supports one active profile plus an edit flow in Settings.
Multiple saved profiles are a v2 feature.

## Package Layout

Add a new desktop package:

- `apps/crawclaw-admin-desktop/package.json`
- `apps/crawclaw-admin-desktop/src/main.ts`
- `apps/crawclaw-admin-desktop/src/preload.ts`
- `apps/crawclaw-admin-desktop/src/backend-launch.ts`
- `apps/crawclaw-admin-desktop/src/credential-store.ts`
- `apps/crawclaw-admin-desktop/src/app-paths.ts`
- `apps/crawclaw-admin-desktop/electron-builder.yml`
- `apps/crawclaw-admin-desktop/tsconfig.json`

Keep admin business code in the existing app:

- `apps/crawclaw-admin/src/**`
- `apps/crawclaw-admin/server/**`

Shared scripts can live at repo root when they are useful outside the desktop
package:

- `scripts/admin-desktop-build.mjs`
- `scripts/admin-desktop-release-check.mjs`

## Runtime Architecture

The desktop host owns process lifecycle:

1. Resolve application paths.
2. Prepare the admin state directory.
3. Load non-sensitive desktop config.
4. Resolve credentials from the OS credential store.
5. Start the admin backend on `127.0.0.1:<randomPort>`.
6. Wait for `/api/health`.
7. Create the BrowserWindow and load the local backend URL.
8. Stop backend child processes when the app exits.

The backend remains the HTTP and SSE surface for the renderer. The renderer
should not call Electron IPC for ordinary admin business actions. IPC is only
for host-owned operations such as opening external URLs, selecting files when
needed, showing native dialogs, and update integration.

## Backend Desktop Mode

The admin backend needs an explicit desktop mode. Add these environment
variables:

- `CRAWCLAW_ADMIN_RUNTIME_MODE=desktop`
- `CRAWCLAW_ADMIN_STATE_DIR`
- `CRAWCLAW_ADMIN_CONFIG_PATH`
- `CRAWCLAW_ADMIN_DATA_DIR`
- `CRAWCLAW_ADMIN_BACKUP_DIR`
- `CRAWCLAW_ADMIN_BIND_HOST=127.0.0.1`
- `CRAWCLAW_ADMIN_PORT=0`
- `CRAWCLAW_ADMIN_SESSION_SECRET`

Desktop mode behavior:

- Bind only to loopback.
- Allow random port selection.
- Disable broad CORS.
- Read and write data under the desktop state directory.
- Avoid writing `.env` in the app bundle or source tree.
- Use an ephemeral local admin session secret generated by the desktop host.
- Disable npm global update endpoints or return a desktop-update response.

The backend should still support the existing web and development modes so
current workflows are not broken.

## Persistent State

Do not write mutable state into the installed app bundle. Use platform
standard user data locations:

- macOS: `~/Library/Application Support/CrawClaw Admin`
- Windows: `%APPDATA%\CrawClaw Admin`
- Linux: `$XDG_CONFIG_HOME/crawclaw-admin` or `~/.config/crawclaw-admin`

Suggested layout:

- `config.json`
- `data/wizard.db`
- `backups/`
- `logs/desktop.log`
- `logs/backend.log`
- `runtime/`

Move the current SQLite path from `apps/crawclaw-admin/data/wizard.db` to the
desktop data directory when `CRAWCLAW_ADMIN_DATA_DIR` is set.

## Credentials

Sensitive values must not live in `.env` for desktop mode. Store them by
service and account:

- service: `CrawClaw Admin`
- account: `gateway-token:<profileId>`
- account: `gateway-password:<profileId>`
- account: `hermes-api-key:<profileId>`

Recommended library:

- `keytar` for Electron desktop credential storage.

Fallback behavior:

- If the OS credential store is unavailable, the app should refuse to persist
  secrets by default.
- A session-only mode may keep credentials in memory until quit.

Non-sensitive values can remain in `config.json`:

- Gateway WebSocket URL.
- Locale.
- Theme.
- Hermes endpoint URLs.
- N8n preferences.
- Last selected profile id.

## Authentication Model

Desktop mode should not rely on the current fixed `AUTH_USERNAME` and
`AUTH_PASSWORD` shape. The desktop host should generate a random per-launch
session secret and pass it to the backend. The renderer receives access through
the loaded loopback page and normal same-origin requests.

Recommended first release behavior:

- No manual admin login screen in desktop mode.
- The app still requires Gateway authentication when the configured Gateway
  requires it.
- The backend should reject requests that do not include the current desktop
  session token.
- The session token should not be written to disk.

This keeps local browser tabs from casually attaching to the desktop backend
without the app's current session context.

## Capability Model

All platform-sensitive features should be gated by a backend capability
snapshot. Add or extend an endpoint such as:

- `GET /api/desktop/capabilities`

Returned fields should include:

- `terminal`
- `files`
- `backup`
- `hermesCli`
- `n8n`
- `comfyuiDownloads`
- `systemMetrics`
- `remoteDesktop`
- `desktopInput`
- `desktopUpdate`

Each capability should carry:

- `available: boolean`
- `platform: "darwin" | "win32" | "linux"`
- `reason?: string`
- `requirements?: string[]`

The frontend should use this to hide, disable, or explain feature availability.
This is especially important for remote desktop because current behavior is
platform-dependent.

## Platform Targets

### macOS

Build targets:

- `dmg`
- `zip`

Required validation:

- App launches on Apple Silicon.
- App launches on Intel if universal builds are enabled.
- Backend starts without system Node.
- Terminal launches the user's default shell.
- Files and backup write under Application Support.
- Gateway connection works with a loopback Gateway.

Signing:

- Use Developer ID Application for release builds.
- Hardened runtime should be enabled.
- The existing `scripts/codesign-mac-app.sh` can be reused or adapted for the
  produced `.app` bundle.
- Notarization is required before stable distribution.

### Windows

Build target:

- `nsis`

Required validation:

- Installer runs on Windows 11.
- App launches without system Node.
- Backend starts and exits cleanly.
- Terminal uses PowerShell by default.
- Files and backup write under `%APPDATA%`.
- Gateway connection works with a loopback Gateway.

Signing:

- Stable release requires Authenticode signing.
- Beta releases may be unsigned only if the release notes say so clearly.

### Linux

Build target:

- `AppImage`

Required validation:

- App launches on Ubuntu 24.04.
- Backend starts without system Node.
- Terminal launches the configured shell.
- Files and backup write under the XDG config directory.
- Gateway connection works with a loopback Gateway.

Signing:

- First release can use checksums attached to GitHub Release assets.
- Package repository distribution is not part of the first release.

## Native Dependencies

The package must rebuild native Node dependencies for Electron:

- `node-pty`
- `better-sqlite3`
- `keytar` if used

Use `@electron/rebuild` in the desktop package build. The release workflow must
run the build on each target OS instead of cross-compiling native modules from a
single platform.

## Update Behavior

The current admin backend can update CrawClaw through `npm install -g`. That
does not fit desktop app distribution.

Desktop update behavior:

- In desktop mode, the existing npm update endpoint should be disabled or
  redirected to desktop update status.
- The desktop app should check GitHub Releases for newer desktop assets.
- First release can show "Download update" and open the release page.
- A later release can add `electron-updater` for automatic downloads.

The CLI npm release flow should remain separate from desktop app releases.

## Release Flow

Add `.github/workflows/admin-desktop-release.yml`.

Trigger:

- `workflow_dispatch`
- optional tag push after the flow is proven

Inputs:

- release tag
- preflight only
- publish draft release
- skip signing for beta builds

Preflight jobs:

- Linux check and AppImage build.
- Windows NSIS build.
- macOS DMG and zip build.
- Admin frontend build.
- Desktop TypeScript build.
- Backend launch smoke.

Publish jobs:

- Upload release assets to GitHub Release.
- Upload checksums.
- Attach build metadata.
- Gate macOS signing and notarization behind the appropriate environment.
- Gate Windows signing behind the appropriate environment.

This flow should not replace the current npm release workflow. It should publish
desktop assets for the same product version.

## Build Commands

Root package scripts should be added after the desktop package exists:

- `admin:build`
- `admin:desktop:build`
- `admin:desktop:pack`
- `admin:desktop:release-check`

The desktop package should expose:

- `npm run build`
- `npm run dev`
- `npm run pack`
- `npm run dist`
- `npm run rebuild:native`

For repository consistency, root scripts should invoke the app-local scripts
instead of duplicating build logic.

## Implementation Phases

### Phase 1: Productize the Backend Runtime

Scope:

- Add desktop runtime environment handling.
- Move mutable paths behind explicit config.
- Support random port binding.
- Add `/api/desktop/capabilities`.
- Make the SQLite path configurable.
- Disable npm global update in desktop mode.

Verification:

- `npm run build` in `apps/crawclaw-admin`.
- Backend launch smoke with `CRAWCLAW_ADMIN_RUNTIME_MODE=desktop`.
- File, backup, and health endpoints use the configured state directory.

### Phase 2: Add the Electron Host

Scope:

- Create `apps/crawclaw-admin-desktop`.
- Add Electron main and preload processes.
- Start the admin backend as a child process.
- Load the backend URL in BrowserWindow.
- Add logging and clean shutdown.

Verification:

- Desktop app starts locally.
- Backend exits when the app exits.
- Reloading the window does not start duplicate backend processes.
- App enforces single-instance behavior.

### Phase 3: Credentials and First Run

Scope:

- Add OS credential storage.
- Add first-run Gateway connection setup.
- Save non-sensitive connection config.
- Load credentials into backend runtime env at launch.

Verification:

- Secrets are not written to `.env`, logs, or `config.json`.
- Saved profile reconnects after app restart.
- Session-only mode works when credential storage is unavailable.

### Phase 4: Platform Gating and UX Cleanup

Scope:

- Wire capability data into admin stores and pages.
- Hide or disable unsupported platform actions.
- Replace desktop-mode npm update UI.
- Add native open-external handling.

Verification:

- Unsupported remote desktop actions do not appear as working actions.
- Terminal, files, backup, and system metrics behave on each target platform.
- Settings clearly reflects desktop update behavior.

### Phase 5: Packaging and CI

Scope:

- Add Electron Builder config.
- Rebuild native dependencies per platform.
- Add GitHub Actions desktop preflight.
- Add release asset upload.
- Add signing and notarization gates.

Verification:

- macOS `.dmg` installs and launches.
- Windows NSIS installer installs and launches.
- Linux AppImage launches.
- Release workflow produces checksums and build metadata.

## Testing Strategy

Use narrow tests while extracting runtime behavior, then add smoke tests for the
desktop package.

Backend tests:

- Config path resolution.
- State directory resolution.
- Desktop capability generation.
- Desktop mode update behavior.
- SQLite path selection.

Desktop tests:

- Backend launch command construction.
- Health wait timeout.
- Clean shutdown.
- Credential store wrapper behavior with mocked keytar.
- Single-instance behavior where testable.

Manual smoke:

- Launch app.
- Configure Gateway.
- Connect to Gateway.
- Open Dashboard.
- Open Chat.
- Open Terminal.
- Browse a workspace file.
- Create and download a backup.
- Quit and confirm child processes stop.

Release smoke:

- Install on a clean machine or VM.
- Start without system Node.
- Connect to local Gateway.
- Restart and confirm saved profile loads.
- Verify no secrets in config and logs.

## Security Notes

The desktop app is a high-trust local operator surface. It can expose admin
Gateway access, filesystem operations, terminal sessions, and backup restore
operations. Treat it as a local admin tool.

Important requirements:

- Bind the desktop backend to loopback only.
- Use random ports in desktop mode.
- Avoid static local admin passwords.
- Store secrets in OS credential storage.
- Do not log secrets.
- Keep desktop session tokens in memory only.
- Keep shell and file operations behind the same auth middleware.
- Avoid broad CORS in desktop mode.
- Make update actions explicit and verifiable.

## Rollout Plan

First public milestone:

- macOS, Windows, and Linux desktop artifacts are built from CI.
- Installers are beta quality.
- All Tier A admin pages load and connect to Gateway.
- Terminal, files, backup, and settings are validated on all three platforms.
- Remote desktop is shown only where the backend reports it as available.
- Updates open the release page instead of running npm.

Stable milestone:

- macOS builds are signed and notarized.
- Windows builds are signed.
- Linux AppImage ships with checksums.
- Release workflow is gated and repeatable.
- Documentation explains desktop app trust, credentials, and platform support.

## Implementation Defaults

Use these defaults for the first implementation plan:

- Support one active Gateway profile.
- Publish separate macOS arm64 and x64 builds unless universal signing is
  already straightforward in CI.
- Allow unsigned Windows beta builds only behind explicit beta labeling.
- Defer automatic update downloads to v2.
- Keep CrawClaw Gateway startup manual in v1; the desktop app connects to an
  existing local or remote Gateway.
