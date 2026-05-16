---
summary: "Install and operate CrawClaw Desktop, the local-first desktop app"
read_when:
  - You want the default local desktop entrypoint for CrawClaw
  - You need to know what the desktop app bundles and starts
  - You are validating platform support or release assets
title: "Desktop"
---

# Desktop

## Tauri and Rust runtime

CrawClaw Desktop lives under `apps/crawclaw-desktop` and uses:

- Tauri v2 for the desktop shell and local process boundary.
- React and Vite for the desktop workbench UI.
- A Rust Gateway bound to `127.0.0.1` for local HTTP and SSE.
- Rust runtime binaries under `runtime/crawclaw/bin/`.
- Rust-native plugin execution for bundled/default desktop tools.
- Rust-native Agent and session control for desktop chat, `sessions_*`, and sub-agents.
- Local speech output through the bundled `qwen3-tts` native path.

The desktop UI talks to `/api/desktop/bootstrap`, `/api/desktop/state`,
`/api/desktop/runtime`, `/api/desktop/events`, `/api/desktop/search`, and the
matching mutation routes on the local Rust Gateway. Desktop session APIs such as
`/api/desktop/sessions/spawn`, `/api/desktop/sessions/send`, and
`/api/desktop/sessions/yield` are backed by the Rust runtime store and do not
start the legacy TypeScript Gateway. The old Admin Desktop package is retired;
new desktop work should target the Tauri app.

CrawClaw Desktop is the supported Apple-platform user entrypoint. Automation and
integrations use the local Gateway API instead of a public shell command.

## Trust model

CrawClaw Desktop is a local control surface for the current machine. It can expose host-level capabilities through the Rust Gateway, including file access, terminal sessions, backups, system metrics, and supported desktop controls.

The Tauri host keeps system integration in the shell and sends ordinary business actions through the local Rust Gateway HTTP and SSE surface.

The backend runs in desktop mode with these constraints:

- It binds to loopback only.
- It uses a random local port selected by the desktop host.
- It stores mutable state outside the app bundle.
- It manages only the local Rust Gateway.
- It does not use npm global self-update behavior; desktop updates come from GitHub Releases.

## Bundled runtime

Desktop packages include the production CrawClaw runtime under the app resources directory:

```text
runtime/crawclaw/bin/crawclaw-runtime
runtime/crawclaw/bin/crawclaw-gateway
runtime/crawclaw/bin/crawclaw-native-plugins
runtime/crawclaw/runtimes/manifest.json
runtime/crawclaw/providers/manifest.json
runtime/crawclaw/plugins/manifest.json
```

The packaged app uses this embedded Rust runtime for local Gateway status checks,
Agent/session state, sub-agent routing, local plugin execution, and desktop
runtime resources. End users do not need a globally installed `crawclaw` binary
or a preconfigured shell `PATH` for the desktop flow.

Bundled/default desktop plugins use Rust-native entries. The desktop product
path does not stage JS runtime support or a QuickJS compatibility fallback.

Desktop speech is intentionally local-first. The desktop package exposes the
native `qwen3-tts` path for text-to-speech; cloud speech plugins are not part of
the default desktop Gateway surface.

## Supported platforms

Desktop release assets are built for:

| Platform | Target artifact  |
| -------- | ---------------- |
| macOS    | `dmg` and `zip`  |
| Windows  | `nsis` installer |
| Linux    | `AppImage`       |

Platform-sensitive features may still differ by OS. The app queries `/api/desktop/capabilities` and disables unsupported actions with the backend-provided reason instead of hiding the route entirely.

## Gateway service

On first launch, CrawClaw Desktop prepares local runtime state in `~/.crawclaw` and writes missing local defaults:

- `gateway.mode=local`
- loopback binding
- the default local Gateway port
- online reconfigure behavior
- local authentication material for the desktop Gateway

The desktop app starts or discovers the local Rust Gateway and passes a
per-launch session token to the renderer. The Rust Gateway owns desktop Agent
chat, session history, sub-agent spawn/send/yield, and local plugin calls.
Closing the desktop window hides the UI. Quitting the desktop app exits the
Tauri shell and its local Gateway process.

## State locations

Runtime state is stored under:

```text
~/.crawclaw
```

Tauri app data stores only desktop UI and shell state. The layout is:

```text
config.json
data/
backups/
logs/
```

Runtime state, transcripts, memory, plugin manifests, and provider configuration remain outside the installed application bundle.

## Gateway connection

CrawClaw Desktop connects to the local Gateway using:

```text
ws://127.0.0.1:18789
```

Remote Gateway, VPS, and headless server deployments use the Gateway API and
server/runtime documentation instead of the desktop UI.

## Updates

Desktop builds update as a single desktop package: the app, embedded Rust runtime, and UI are delivered together.

When a desktop update is available, install the platform asset from [GitHub Releases](https://github.com/qianleigood/crawclaw/releases).

## Beta limitations

- Automatic desktop update downloads are not included in this pass.
- Store distribution is not included.
- Remote desktop parity is not guaranteed across all platforms.
- Signing and notarization depend on the release workflow inputs and maintainer credentials.

## Build from source

For local packaging work:

```bash
pnpm desktop:tauri:stage-runtime
pnpm desktop:tauri:dev
pnpm desktop:tauri:build
```

For release validation:

```bash
pnpm desktop:tauri:release-check
```

Desktop app updates are handled through GitHub Releases.
