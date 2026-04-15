---
summary: "Integrated browser automation tool backed by PinchTab"
read_when:
  - Adding agent-controlled browser automation
  - Debugging why CrawClaw is interfering with your own Chrome
  - Implementing browser settings + lifecycle in local clients or node hosts
title: "Browser (CrawClaw-managed)"
---

# Browser (crawclaw-managed)

CrawClaw can run a browser session that the agent controls through **PinchTab**.
It stays isolated from your personal browser by default.

Beginner view:

- Think of it as a **separate, agent-only browser**.
- The `crawclaw` profile does **not** touch your personal browser profile.
- The agent can **open tabs, read pages, click, and type** in a safe lane.
- New browser server behavior is standardized on the PinchTab backend.

## What you get

- A separate browser profile named **crawclaw** (orange accent by default).
- Deterministic tab control (list/open/focus/close).
- Agent actions (click/type/drag/select), snapshots, screenshots, PDFs.
- Optional multi-profile support (`crawclaw`, `work`, `remote`, ...).

This browser is **not** your daily driver. It is a safe, isolated surface for
agent automation and verification.

## Quick start

```bash
crawclaw browser --browser-profile crawclaw status
crawclaw browser --browser-profile crawclaw start
crawclaw browser --browser-profile crawclaw open https://example.com
crawclaw browser --browser-profile crawclaw snapshot
```

If you get “Browser disabled”, enable it in config (see below) and restart the
Gateway.

If `crawclaw browser` is missing entirely, or the agent says the browser tool
is unavailable, jump to [Missing browser command or tool](/tools/browser#missing-browser-command-or-tool).

## Plugin control

The default `browser` tool is now a bundled plugin that ships enabled by
default. That means you can disable or replace it without removing the rest of
CrawClaw's plugin system:

```json5
{
  plugins: {
    entries: {
      browser: {
        enabled: false,
      },
    },
  },
}
```

Disable the bundled plugin before installing another plugin that provides the
same `browser` tool name. The default browser experience needs both:

- `plugins.entries.browser.enabled` not disabled
- `browser.enabled=true`

If you turn off only the plugin, the bundled browser tool disappears together.
Your `browser.*` config stays intact for a replacement plugin to reuse.

## PinchTab execution engine

CrawClaw now runs the `browser` tool through PinchTab across all routes.

Current scope:

- `host` route talks to the local PinchTab server.
- `sandbox` route talks to the sandbox-exposed PinchTab endpoint.
- `node` route uses the node-side PinchTab proxy path.
- Legacy `targetId`-only workflows are intentionally no longer adapted.

Current action coverage:

- `status`
- `open`
- `navigate`
- `focus`
- `close`
- `snapshot`
- `screenshot`
- `pdf`
- `tabs`
- `console`
- `upload`
- `dialog`
- `act` common subset (`click`, `dblclick`, `type`, `press`, `hover`, `drag`, `select`, `wait`, `evaluate`, `resize`, `close`)

Browser config changes still require a Gateway restart so the bundled plugin
can re-register with the new settings.

## Missing browser command or tool

If `crawclaw browser` suddenly becomes an unknown command after an upgrade, or
the agent reports that the browser tool is missing, the most common cause is a
restrictive `plugins.allow` list that does not include `browser`.

Example broken config:

```json5
{
  plugins: {
    allow: ["telegram"],
  },
}
```

Fix it by adding `browser` to the plugin allowlist:

```json5
{
  plugins: {
    allow: ["telegram", "browser"],
  },
}
```

Important notes:

- `browser.enabled=true` is not enough by itself when `plugins.allow` is set.
- `plugins.entries.browser.enabled=true` is also not enough by itself when `plugins.allow` is set.
- `tools.alsoAllow: ["browser"]` does **not** load the bundled browser plugin. It only adjusts tool policy after the plugin is already loaded.
- If you do not need a restrictive plugin allowlist, removing `plugins.allow` also restores the default bundled browser behavior.

Typical symptoms:

- `crawclaw browser` is an unknown command.
- `browser.request` is missing.
- The agent reports the browser tool as unavailable or missing.

## Profiles

- `crawclaw`: managed, isolated browser backed by PinchTab.
- additional named profiles: logical browser routes/config labels that still
  resolve through the PinchTab-backed browser server.

For agent browser tool calls:

- Default: use the isolated `crawclaw` browser.
- `profile` is the explicit override when you want a specific browser mode.

Set `browser.defaultProfile: "crawclaw"` if you want managed mode by default.

## Configuration

Browser settings live in `~/.crawclaw/crawclaw.json`.

```json5
{
  browser: {
    enabled: true, // default: true
    evaluateEnabled: true,
    ssrfPolicy: {
      dangerouslyAllowPrivateNetwork: true, // default trusted-network mode
      // allowPrivateNetwork: true, // legacy alias
      // hostnameAllowlist: ["*.example.com", "example.com"],
      // allowedHostnames: ["localhost"],
    },
    defaultProfile: "crawclaw",
    color: "#FF4500",
    headless: false,
    noSandbox: false,
    profiles: {
      crawclaw: { color: "#FF4500" },
      work: { color: "#0066CC" },
    },
  },
}
```

Notes:

- The browser control service binds to loopback on a port derived from
  `gateway.port` (default: `18791`, which is gateway + 2).
- If you override the Gateway port (`gateway.port` or `CRAWCLAW_GATEWAY_PORT`),
  the derived browser ports shift to stay in the same “family”.
- Browser navigation/open-tab is SSRF-guarded before navigation and best-effort re-checked on final `http(s)` URL after navigation.
- `browser.ssrfPolicy.dangerouslyAllowPrivateNetwork` defaults to `true` (trusted-network model). Set it to `false` for strict public-only browsing.
- `browser.ssrfPolicy.allowPrivateNetwork` remains supported as a legacy alias for compatibility.
- `color` + per-profile `color` tint the browser UI so you can see which profile is active.
- Default profile is `crawclaw`.
- The bundled browser server is PinchTab-only. Profile creation and runtime
  control use managed `crawclaw` profiles.

## Local vs remote control

- **Local control (default):** the Gateway starts the loopback control service and can launch a local browser.
- **Remote control (node host):** run a node host on the machine that has the browser; the Gateway proxies browser actions to it.
- **Remote CDP:** set `browser.profiles.<name>.cdpUrl` (or `browser.cdpUrl`) to
  attach to a remote Chromium-based browser. In this case, CrawClaw will not launch a local browser.

Remote CDP URLs can include auth:

- Query tokens (e.g., `https://provider.example?token=<token>`)
- HTTP Basic auth (e.g., `https://user:pass@provider.example`)

CrawClaw preserves the auth when calling `/json/*` endpoints and when connecting
to the CDP WebSocket. Prefer environment variables or secrets managers for
tokens instead of committing them to config files.

## Node browser proxy (zero-config default)

If you run a **node host** on the machine that has your browser, CrawClaw can
auto-route browser tool calls to that node without any extra browser config.
This is the default path for remote gateways.

Notes:

- The node host exposes its local browser automation capability via a **proxy command**.
- Profiles come from the node’s own `browser.profiles` config (same as local).
- `nodeHost.browserProxy.allowProfiles` is optional. Leave it empty for the legacy/default behavior: all configured profiles remain reachable through the proxy, including profile create/delete routes.
- If you set `nodeHost.browserProxy.allowProfiles`, CrawClaw treats it as a least-privilege boundary: only allowlisted profiles can be targeted, and persistent profile create/delete routes are blocked on the proxy surface.
- Disable if you don’t want it:
  - On the node: `nodeHost.browserProxy.enabled=false`
  - On the gateway: `gateway.nodes.browser.mode="off"`

## Browserless (hosted remote CDP)

[Browserless](https://browserless.io) is a hosted Chromium service that exposes
CDP connection URLs over HTTPS and WebSocket. CrawClaw can use either form, but
for a remote browser profile the simplest option is the direct WebSocket URL
from Browserless' connection docs.

Example:

```json5
{
  browser: {
    enabled: true,
    defaultProfile: "browserless",
    remoteCdpTimeoutMs: 2000,
    remoteCdpHandshakeTimeoutMs: 4000,
    profiles: {
      browserless: {
        cdpUrl: "wss://production-sfo.browserless.io?token=<BROWSERLESS_API_KEY>",
        color: "#00AA00",
      },
    },
  },
}
```

Notes:

- Replace `<BROWSERLESS_API_KEY>` with your real Browserless token.
- Choose the region endpoint that matches your Browserless account (see their docs).
- If Browserless gives you an HTTPS base URL, you can either convert it to
  `wss://` for a direct CDP connection or keep the HTTPS URL and let CrawClaw
  discover `/json/version`.

## Direct WebSocket CDP providers

Some hosted browser services expose a **direct WebSocket** endpoint rather than
the standard HTTP-based CDP discovery (`/json/version`). CrawClaw supports both:

- **HTTP(S) endpoints** — CrawClaw calls `/json/version` to discover the
  WebSocket debugger URL, then connects.
- **WebSocket endpoints** (`ws://` / `wss://`) — CrawClaw connects directly,
  skipping `/json/version`. Use this for services like
  [Browserless](https://browserless.io),
  [Browserbase](https://www.browserbase.com), or any provider that hands you a
  WebSocket URL.

### Browserbase

[Browserbase](https://www.browserbase.com) is a cloud platform for running
headless browsers with built-in CAPTCHA solving, stealth mode, and residential
proxies.

```json5
{
  browser: {
    enabled: true,
    defaultProfile: "browserbase",
    remoteCdpTimeoutMs: 3000,
    remoteCdpHandshakeTimeoutMs: 5000,
    profiles: {
      browserbase: {
        cdpUrl: "wss://connect.browserbase.com?apiKey=<BROWSERBASE_API_KEY>",
        color: "#F97316",
      },
    },
  },
}
```

Notes:

- [Sign up](https://www.browserbase.com/sign-up) and copy your **API Key**
  from the [Overview dashboard](https://www.browserbase.com/overview).
- Replace `<BROWSERBASE_API_KEY>` with your real Browserbase API key.
- Browserbase auto-creates a browser session on WebSocket connect, so no
  manual session creation step is needed.
- The free tier allows one concurrent session and one browser hour per month.
  See [pricing](https://www.browserbase.com/pricing) for paid plan limits.
- See the [Browserbase docs](https://docs.browserbase.com) for full API
  reference, SDK guides, and integration examples.

## Security

Key ideas:

- Browser control is loopback-only; access flows through the Gateway’s auth or node pairing.
- If browser control is enabled and no auth is configured, CrawClaw auto-generates `gateway.auth.token` on startup and persists it to config.
- Keep the Gateway and any node hosts on a private network (Tailscale); avoid public exposure.
- Treat remote CDP URLs/tokens as secrets; prefer env vars or a secrets manager.

Remote CDP tips:

- Prefer encrypted endpoints (HTTPS or WSS) and short-lived tokens where possible.
- Avoid embedding long-lived tokens directly in config files.

## Profiles (multi-browser)

CrawClaw supports multiple named profiles (routing configs). Profiles can be:

- **crawclaw-managed**: a dedicated managed browser profile routed through PinchTab
- **remote**: run a node host on the machine that has the browser and let the Gateway proxy browser actions there

Defaults:

- The `crawclaw` profile is auto-created if missing.
- Local CDP ports allocate from **18800–18899** by default.
- Deleting a profile moves its local data directory to Trash.

All control endpoints accept `?profile=<name>`; the CLI uses `--browser-profile`.

Notes:

- This path is higher-risk than the isolated `crawclaw` profile because it can
  act inside your signed-in browser session.
- For a browser running on another host or namespace, use remote CDP or a node
  host instead of treating it as a local managed profile.

## Isolation guarantees

- **Dedicated user data dir**: never touches your personal browser profile.
- **Dedicated ports**: avoids `9222` to prevent collisions with dev workflows.
- **Deterministic tab control**: target tabs by `targetId`, not “last tab”.

## Browser selection

When launching locally, CrawClaw picks the first available:

1. Chrome
2. Brave
3. Edge
4. Chromium
5. Chrome Canary

You can override with `browser.executablePath`.

Platforms:

- macOS: checks `/Applications` and `~/Applications`.
- Linux: looks for `google-chrome`, `brave`, `microsoft-edge`, `chromium`, etc.
- Windows: checks common install locations.

## Control API (optional)

For local integrations only, the Gateway exposes a small loopback HTTP API:

- Status/start/stop: `GET /`, `POST /start`, `POST /stop`
- Tabs: `GET /tabs`, `POST /tabs/open`, `POST /tabs/focus`, `DELETE /tabs/:targetId`
- Snapshot/screenshot: `GET /snapshot`, `POST /screenshot`
- Actions: `POST /navigate`, `POST /act`
- Hooks: `POST /hooks/file-chooser`, `POST /hooks/dialog`
- Downloads: `POST /download`, `POST /wait/download`
- Debugging: `GET /console`, `POST /pdf`
- Debugging: `GET /errors`, `GET /requests`, `POST /trace/start`, `POST /trace/stop`, `POST /highlight`
- Network: `POST /response/body`
- State: `GET /cookies`, `POST /cookies/set`, `POST /cookies/clear`
- State: `GET /storage/:kind`, `POST /storage/:kind/set`, `POST /storage/:kind/clear`
- Settings: `POST /set/offline`, `POST /set/headers`, `POST /set/credentials`, `POST /set/geolocation`, `POST /set/media`, `POST /set/timezone`, `POST /set/locale`, `POST /set/device`

All endpoints accept `?profile=<name>`.

If gateway auth is configured, browser HTTP routes require auth too:

- `Authorization: Bearer <gateway token>`
- `x-crawclaw-password: <gateway password>` or HTTP Basic auth with that password

### Unified backend note

The bundled browser server now uses a single PinchTab backend.

Practical guidance:

- Prefer the default managed `crawclaw` profile.
- If a browser server endpoint returns `501`, that usually means the capability
  has not been exposed on the unified PinchTab backend yet.

## How it works (internal)

High-level flow:

- The bundled browser plugin routes calls through **PinchTab** on `host`,
  `sandbox`, or `node`.
- The browser control server now uses the same PinchTab backend for browser
  lifecycle and tab management endpoints such as status/start/stop/reset and
  tab list/open/focus/close, so CLI and HTTP entrypoints share the same runtime
  for these operations.
- PinchTab is the single execution backend for the bundled browser server and
  tool routes on `host`, `sandbox`, and `node`.

This design keeps the agent on a stable, deterministic interface while letting
you keep browser automation on one control plane.

## CLI quick reference

All commands accept `--browser-profile <name>` to target a specific profile.
All commands also accept `--json` for machine-readable output (stable payloads).

Basics:

- `crawclaw browser status`
- `crawclaw browser start`
- `crawclaw browser stop`
- `crawclaw browser tabs`
- `crawclaw browser tab`
- `crawclaw browser tab new`
- `crawclaw browser tab select 2`
- `crawclaw browser tab close 2`
- `crawclaw browser open https://example.com`
- `crawclaw browser focus abcd1234`
- `crawclaw browser close abcd1234`

Inspection:

- `crawclaw browser screenshot`
- `crawclaw browser screenshot --full-page`
- `crawclaw browser screenshot --ref 12`
- `crawclaw browser screenshot --ref e12`
- `crawclaw browser snapshot`
- `crawclaw browser snapshot --format aria --limit 200`
- `crawclaw browser snapshot --interactive --compact --depth 6`
- `crawclaw browser snapshot --efficient`
- `crawclaw browser snapshot --labels`
- `crawclaw browser snapshot --selector "#main" --interactive`
- `crawclaw browser snapshot --frame "iframe#main" --interactive`
- `crawclaw browser console --level error`
- `crawclaw browser errors --clear`
- `crawclaw browser requests --filter api --clear`
- `crawclaw browser pdf`
- `crawclaw browser responsebody "**/api" --max-chars 5000`

Actions:

- `crawclaw browser navigate https://example.com`
- `crawclaw browser resize 1280 720`
- `crawclaw browser click 12 --double`
- `crawclaw browser click e12 --double`
- `crawclaw browser type 23 "hello" --submit`
- `crawclaw browser press Enter`
- `crawclaw browser hover 44`
- `crawclaw browser scrollintoview e12`
- `crawclaw browser drag 10 11`
- `crawclaw browser select 9 OptionA OptionB`
- `crawclaw browser download e12 report.pdf`
- `crawclaw browser waitfordownload report.pdf`
- `crawclaw browser upload /tmp/crawclaw/uploads/file.pdf`
- `crawclaw browser fill --fields '[{"ref":"1","type":"text","value":"Ada"}]'`
- `crawclaw browser dialog --accept`
- `crawclaw browser wait --text "Done"`
- `crawclaw browser wait "#main" --url "**/dash" --load networkidle --fn "window.ready===true"`
- `crawclaw browser evaluate --fn '(el) => el.textContent' --ref 7`
- `crawclaw browser highlight e12`
- `crawclaw browser trace start`
- `crawclaw browser trace stop`

State:

- `crawclaw browser cookies`
- `crawclaw browser cookies set session abc123 --url "https://example.com"`
- `crawclaw browser cookies clear`
- `crawclaw browser storage local get`
- `crawclaw browser storage local set theme dark`
- `crawclaw browser storage session clear`
- `crawclaw browser set offline on`
- `crawclaw browser set headers --headers-json '{"X-Debug":"1"}'`
- `crawclaw browser set credentials user pass`
- `crawclaw browser set credentials --clear`
- `crawclaw browser set geo 37.7749 -122.4194 --origin "https://example.com"`
- `crawclaw browser set geo --clear`
- `crawclaw browser set media dark`
- `crawclaw browser set timezone America/New_York`
- `crawclaw browser set locale en-US`
- `crawclaw browser set device "iPhone 14"`

Notes:

- `upload` and `dialog` are **arming** calls; run them before the click/press
  that triggers the chooser/dialog.
- Download and trace output paths are constrained to CrawClaw temp roots:
  - traces: `/tmp/crawclaw` (fallback: `${os.tmpdir()}/crawclaw`)
  - downloads: `/tmp/crawclaw/downloads` (fallback: `${os.tmpdir()}/crawclaw/downloads`)
- Upload paths are constrained to a CrawClaw temp uploads root:
  - uploads: `/tmp/crawclaw/uploads` (fallback: `${os.tmpdir()}/crawclaw/uploads`)
- `upload` can also set file inputs directly via `--input-ref` or `--element`.
- `snapshot`:
  - `--format ai` (default when Playwright is installed): returns an AI snapshot with numeric refs (`aria-ref="<n>"`).
  - `--format aria`: returns the accessibility tree (no refs; inspection only).
  - `--efficient` (or `--mode efficient`): compact role snapshot preset (interactive + compact + depth + lower maxChars).
  - Config default (tool/CLI only): set `browser.snapshotDefaults.mode: "efficient"` to use efficient snapshots when the caller does not pass a mode (see [Gateway configuration](/gateway/configuration-reference#browser)).
  - Role snapshot options (`--interactive`, `--compact`, `--depth`, `--selector`) force a role-based snapshot with refs like `ref=e12`.
  - `--frame "<iframe selector>"` scopes role snapshots to an iframe (pairs with role refs like `e12`).
  - `--interactive` outputs a flat, easy-to-pick list of interactive elements (best for driving actions).
  - `--labels` adds a viewport-only screenshot with overlayed ref labels (prints `MEDIA:<path>`).
- `click`/`type`/etc require a `ref` from `snapshot` (either numeric `12` or role ref `e12`).
  CSS selectors are intentionally not supported for actions.

## Snapshots and refs

CrawClaw supports two “snapshot” styles:

- **AI snapshot (numeric refs)**: `crawclaw browser snapshot` (default; `--format ai`)
  - Output: a text snapshot that includes numeric refs.
  - Actions: `crawclaw browser click 12`, `crawclaw browser type 23 "hello"`.
  - Internally, the ref is resolved via Playwright’s `aria-ref`.

- **Role snapshot (role refs like `e12`)**: `crawclaw browser snapshot --interactive` (or `--compact`, `--depth`, `--selector`, `--frame`)
  - Output: a role-based list/tree with `[ref=e12]` (and optional `[nth=1]`).
  - Actions: `crawclaw browser click e12`, `crawclaw browser highlight e12`.
  - Internally, the ref is resolved via `getByRole(...)` (plus `nth()` for duplicates).
  - Add `--labels` to include a viewport screenshot with overlayed `e12` labels.

Ref behavior:

- Refs are **not stable across navigations**; if something fails, re-run `snapshot` and use a fresh ref.
- If the role snapshot was taken with `--frame`, role refs are scoped to that iframe until the next role snapshot.

## Wait power-ups

You can wait on more than just time/text:

- Wait for URL (globs supported by Playwright):
  - `crawclaw browser wait --url "**/dash"`
- Wait for load state:
  - `crawclaw browser wait --load networkidle`
- Wait for a JS predicate:
  - `crawclaw browser wait --fn "window.ready===true"`
- Wait for a selector to become visible:
  - `crawclaw browser wait "#main"`

These can be combined:

```bash
crawclaw browser wait "#main" \
  --url "**/dash" \
  --load networkidle \
  --fn "window.ready===true" \
  --timeout-ms 15000
```

## Debug workflows

When an action fails (e.g. “not visible”, “strict mode violation”, “covered”):

1. `crawclaw browser snapshot --interactive`
2. Use `click <ref>` / `type <ref>` (prefer role refs in interactive mode)
3. If it still fails: `crawclaw browser highlight <ref>` to see what Playwright is targeting
4. If the page behaves oddly:
   - `crawclaw browser errors --clear`
   - `crawclaw browser requests --filter api --clear`
5. For deep debugging: record a trace:
   - `crawclaw browser trace start`
   - reproduce the issue
   - `crawclaw browser trace stop` (prints `TRACE:<path>`)

## JSON output

`--json` is for scripting and structured tooling.

Examples:

```bash
crawclaw browser status --json
crawclaw browser snapshot --interactive --json
crawclaw browser requests --filter api --json
crawclaw browser cookies --json
```

Role snapshots in JSON include `refs` plus a small `stats` block (lines/chars/refs/interactive) so tools can reason about payload size and density.

## State and environment knobs

These are useful for “make the site behave like X” workflows:

- Cookies: `cookies`, `cookies set`, `cookies clear`
- Storage: `storage local|session get|set|clear`
- Offline: `set offline on|off`
- Headers: `set headers --headers-json '{"X-Debug":"1"}'` (legacy `set headers --json '{"X-Debug":"1"}'` remains supported)
- HTTP basic auth: `set credentials user pass` (or `--clear`)
- Geolocation: `set geo <lat> <lon> --origin "https://example.com"` (or `--clear`)
- Media: `set media dark|light|no-preference|none`
- Timezone / locale: `set timezone ...`, `set locale ...`
- Device / viewport:
  - `set device "iPhone 14"` (Playwright device presets)
  - `set viewport 1280 720`

## Security & privacy

- The crawclaw browser profile may contain logged-in sessions; treat it as sensitive.
- `browser act kind=evaluate` / `crawclaw browser evaluate` and `wait --fn`
  execute arbitrary JavaScript in the page context. Prompt injection can steer
  this. Disable it with `browser.evaluateEnabled=false` if you do not need it.
- For logins and anti-bot notes (X/Twitter, etc.), see [Browser login + X/Twitter posting](/tools/browser-login).
- Keep the Gateway/node host private (loopback or tailnet-only).
- Remote CDP endpoints are powerful; tunnel and protect them.

Strict-mode example (block private/internal destinations by default):

```json5
{
  browser: {
    ssrfPolicy: {
      dangerouslyAllowPrivateNetwork: false,
      hostnameAllowlist: ["*.example.com", "example.com"],
      allowedHostnames: ["localhost"], // optional exact allow
    },
  },
}
```

## Troubleshooting

For Linux-specific issues (especially snap Chromium), see
[Browser troubleshooting](/tools/browser-linux-troubleshooting).

For WSL2 Gateway + Windows Chrome split-host setups, see
[WSL2 + Windows + remote Chrome CDP troubleshooting](/tools/browser-wsl2-windows-remote-cdp-troubleshooting).

## Agent tools + how control works

The agent gets **one tool** for browser automation:

- `browser` — status/start/stop/tabs/open/focus/close/snapshot/screenshot/navigate/act

How it maps:

- `browser snapshot` returns a stable UI tree (AI or ARIA).
- `browser act` uses the snapshot `ref` IDs to click/type/drag/select.
- `browser screenshot` captures pixels (full page or element).
- `browser` accepts:
  - `profile` to choose a named browser profile (crawclaw, chrome, or remote CDP).
  - `target` (`sandbox` | `host` | `node`) to select where the browser lives.
  - In sandboxed sessions, `target: "host"` requires `agents.defaults.sandbox.browser.allowHostControl=true`.
  - If `target` is omitted: sandboxed sessions default to `sandbox`, non-sandbox sessions default to `host`.
  - If a browser-capable node is connected, the tool may auto-route to it unless you pin `target="host"` or `target="node"`.

This keeps the agent deterministic and avoids brittle selectors.

## Related

- [Tools Overview](/tools) — all available agent tools
- [Sandboxing](/gateway/sandboxing) — browser control in sandboxed environments
- [Security](/gateway/security) — browser control risks and hardening
