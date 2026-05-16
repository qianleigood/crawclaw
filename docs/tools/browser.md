---
summary: "Integrated browser automation tool backed by the Rust native agent-browser runtime"
read_when:
  - Adding agent-controlled browser automation
  - Debugging why CrawClaw is interfering with your own Chrome
  - Implementing browser settings + lifecycle in local clients
title: "Browser (CrawClaw-managed)"
---

# Browser (crawclaw-managed)

CrawClaw can run a browser session that the agent controls through the Rust native
`browser` tool backed by the managed `agent-browser` CLI. It stays isolated
from your personal browser by default.

Beginner view:

- Think of it as a **separate, agent-only browser**.
- The `crawclaw` profile does **not** touch your personal browser profile.
- The agent can **open tabs, read pages, click, and type** in a safe lane.
- Browser execution is owned by the Rust native plugin registry.

## What you get

- A separate browser profile named **crawclaw** (orange accent by default).
- Deterministic tab control (list/open/focus/close).
- Agent actions (click/type/drag/select), snapshots, screenshots, PDFs.
- Optional multi-profile support (`crawclaw`, `work`, `remote`, ...).

This browser is **not** your daily driver. It is a safe, isolated surface for
agent automation and verification.

## Quick start

Use the agent `browser` tool. When calling it directly through
[`/tools/invoke`](/gateway/tools-invoke-http-api), put the object below under
`args`:

```json
{ "action": "status", "profile": "crawclaw" }
```

```json
{ "action": "open", "profile": "crawclaw", "url": "https://example.com" }
```

```json
{ "action": "snapshot", "profile": "crawclaw", "interactive": true }
```

If you get “Browser disabled”, enable it in config (see below) and restart the
Gateway.

If the agent says the browser tool is unavailable, jump to
[Missing browser tool](/tools/browser#missing-browser-tool).

## Native tool control

The default `browser` tool is now registered by the bundled Rust native plugin
registry. Keep `browser.enabled=true` and `browser.provider=agent-browser` (or
leave provider unset) to use the managed runtime:

```json5
{
  browser: {
    enabled: true,
    provider: "agent-browser",
  },
}
```

Local onboarding keeps the `coding` tool profile for new configs. The native
`browser` tool is part of that profile, so it is available to the default
`main` agent when browser config is enabled.

## agent-browser execution engine

CrawClaw now runs the `browser` tool through Rust native dispatch. The handler
spawns the managed `agent-browser` CLI with JSON output and maps the response
back into CrawClaw tool content.

Current scope:

- `host` is the supported local execution target.
- `node` browser proxy routes are no longer supported.
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

Browser config changes are read by the native runtime at invocation time.

## Missing browser tool

If the agent reports that the browser tool is missing, check
`tools.catalog`/`tools.effective` first. In current builds the tool should
appear under `native-plugin` with `pluginId: "browser"`.

Typical symptoms:

- The agent reports the browser tool as unavailable or missing.

If an old example shows CrawClaw Desktop or the local Gateway API, use the current `browser` tool
instead. The standalone browser CLI is no longer registered in current CrawClaw
builds.

## Profiles

- `crawclaw`: managed, isolated browser backed by `agent-browser`.
- additional named profiles: logical browser labels passed to `agent-browser`.

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
    profiles: {
      crawclaw: { color: "#FF4500" },
      work: { color: "#0066CC" },
    },
  },
}
```

Notes:

- Browser navigation/open-tab is SSRF-guarded before navigation and best-effort re-checked on final `http(s)` URL after navigation.
- `browser.ssrfPolicy.dangerouslyAllowPrivateNetwork` defaults to `true` (trusted-network model). Set it to `false` for strict public-only browsing.
- `browser.ssrfPolicy.allowPrivateNetwork` remains supported as a legacy alias for compatibility.
- `color` + per-profile `color` tint the browser UI so you can see which profile is active.
- Default profile is `crawclaw`.
- The native runtime can launch an `agent-browser` CLI when one is explicitly
  available to the native runtime.

## Runtime model

- **Local control (default):** the Rust native handler launches the managed
  `agent-browser` CLI on demand.
- **Profiles:** `profile` selects the browser profile passed to `agent-browser`;
  `user` maps to the default user browser profile.
- **Runtime install:** run CrawClaw Desktop or the local Gateway API if the managed
  `agent-browser` binary is missing.

## Security

Key ideas:

- Browser output is treated as untrusted page content.
- Snapshot output is wrapped with an external-content boundary before it reaches
  the agent.
- Keep any configured browser executable or profile paths local and trusted.

## Profiles (multi-browser)

CrawClaw supports multiple named profiles (routing configs). Profiles can be:

- **crawclaw-managed**: a dedicated managed browser profile routed through `agent-browser`
- **user**: the default user browser profile when explicitly requested

Defaults:

- The `crawclaw` profile is auto-created if missing.
- Deleting a profile moves its local data directory to Trash.

The agent tool uses the `profile` argument.

Notes:

- This path is higher-risk than the isolated `crawclaw` profile because it can
  act inside your signed-in browser session.
- Remote CDP and node proxy routes are not part of the native browser runtime.

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

## How it works (internal)

High-level flow:

- The Rust native plugin registry declares the `browser` tool and
  `browser-agent-browser-runtime` service.
- The native browser handler maps CrawClaw tool arguments to `agent-browser`
  CLI arguments and requests JSON output.
- Snapshot output is wrapped as external untrusted content.
- Screenshot output is returned as image content, not just a filesystem path.

This design keeps the agent on a stable, deterministic interface while letting
you keep browser automation on one control plane.

## Agent tool quick reference

The `browser` tool accepts a top-level `action` plus optional `profile`,
`target`, `node`, `targetId`, and action-specific fields. When calling through
[`/tools/invoke`](/gateway/tools-invoke-http-api), pass the same object as
`args`.

Basics:

- Status: `{ "action": "status" }`
- Start: `{ "action": "start" }`
- Stop: `{ "action": "stop" }`
- Profiles: `{ "action": "profiles" }`
- Tabs: `{ "action": "tabs" }`
- Open: `{ "action": "open", "url": "https://example.com" }`
- Focus: `{ "action": "focus", "targetId": "abcd1234" }`
- Close: `{ "action": "close", "targetId": "abcd1234" }`

Inspection:

- Screenshot: `{ "action": "screenshot", "fullPage": true }`
- Element screenshot: `{ "action": "screenshot", "ref": "e12" }`
- AI snapshot: `{ "action": "snapshot", "snapshotFormat": "ai" }`
- Role snapshot: `{ "action": "snapshot", "interactive": true, "compact": true, "depth": 6 }`
- Scoped snapshot: `{ "action": "snapshot", "selector": "#main", "interactive": true }`
- Frame snapshot: `{ "action": "snapshot", "frame": "iframe#main", "interactive": true }`
- Console: `{ "action": "console", "level": "error" }`
- PDF: `{ "action": "pdf" }`

Actions:

- Navigate: `{ "action": "navigate", "url": "https://example.com" }`
- Resize: `{ "action": "act", "kind": "resize", "width": 1280, "height": 720 }`
- Click: `{ "action": "act", "kind": "click", "ref": "e12" }`
- Type: `{ "action": "act", "kind": "type", "ref": "e12", "text": "hello", "submit": true }`
- Press: `{ "action": "act", "kind": "press", "key": "Enter" }`
- Hover: `{ "action": "act", "kind": "hover", "ref": "e12" }`
- Drag: `{ "action": "act", "kind": "drag", "startRef": "e10", "endRef": "e11" }`
- Select: `{ "action": "act", "kind": "select", "ref": "e9", "values": ["OptionA", "OptionB"] }`
- Upload: `{ "action": "upload", "paths": ["/tmp/crawclaw/uploads/file.pdf"] }`
- File input upload: `{ "action": "upload", "inputRef": "e12", "paths": ["/tmp/crawclaw/uploads/file.pdf"] }`
- Dialog: `{ "action": "dialog", "accept": true }`
- Wait: `{ "action": "act", "kind": "wait", "selector": "#main", "timeoutMs": 15000 }`
- Evaluate: `{ "action": "act", "kind": "evaluate", "ref": "e7", "fn": "(el) => el.textContent" }`

State and network:

- Cookies: `{ "action": "cookies" }`
- Local storage: `{ "action": "storage", "storageKind": "local" }`
- Session storage: `{ "action": "storage", "storageKind": "session" }`
- Network requests: `{ "action": "network", "pattern": "api" }`
- Downloads: `{ "action": "download", "filename": "report.pdf" }`

Migration note: old CrawClaw Desktop or the local Gateway API examples have no current standalone
CLI equivalent. Use the `browser` tool from an agent session or call it through
the Gateway [Tools Invoke API](/gateway/tools-invoke-http-api).

Notes:

- `upload` and `dialog` are **arming** calls; run them before the click/press
  that triggers the chooser/dialog.
- Download and trace output paths are constrained to CrawClaw temp roots:
  - traces: `/tmp/crawclaw` (fallback: `${os.tmpdir()}/crawclaw`)
  - downloads: `/tmp/crawclaw/downloads` (fallback: `${os.tmpdir()}/crawclaw/downloads`)
- Upload paths are constrained to a CrawClaw temp uploads root:
  - uploads: `/tmp/crawclaw/uploads` (fallback: `${os.tmpdir()}/crawclaw/uploads`)
- `upload` can also set file inputs directly with `inputRef` or `element`.
- `snapshot`:
  - `snapshotFormat: "ai"` (default when Playwright is installed): returns an AI snapshot with numeric refs (`aria-ref="<n>"`).
  - `snapshotFormat: "aria"`: returns the accessibility tree (no refs; inspection only).
  - `mode: "efficient"`: compact role snapshot preset (interactive + compact + depth + lower maxChars).
  - Config default: set `browser.snapshotDefaults.mode: "efficient"` to use efficient snapshots when the caller does not pass a mode (see [Gateway configuration](/gateway/configuration-reference#browser)).
  - Role snapshot fields (`interactive`, `compact`, `depth`, `selector`) force a role-based snapshot with refs like `ref=e12`.
  - `frame: "<iframe selector>"` scopes role snapshots to an iframe (pairs with role refs like `e12`).
  - `interactive: true` outputs a flat, easy-to-pick list of interactive elements (best for driving actions).
  - `labels: true` adds a viewport-only screenshot with overlayed ref labels.
- `click`/`type`/etc require a `ref` from `snapshot` (either numeric `12` or role ref `e12`).
  CSS selectors are intentionally not supported for actions.

## Snapshots and refs

CrawClaw supports two “snapshot” styles:

- **AI snapshot (numeric refs)**: `{ "action": "snapshot", "snapshotFormat": "ai" }`
  - Output: a text snapshot that includes numeric refs.
  - Actions: `{ "action": "act", "kind": "click", "ref": "12" }` and `{ "action": "act", "kind": "type", "ref": "23", "text": "hello" }`.
  - Internally, the ref is resolved via Playwright’s `aria-ref`.

- **Role snapshot (role refs like `e12`)**: `{ "action": "snapshot", "interactive": true }` (optionally with `compact`, `depth`, `selector`, or `frame`)
  - Output: a role-based list/tree with `[ref=e12]` (and optional `[nth=1]`).
  - Actions: `{ "action": "act", "kind": "click", "ref": "e12" }`.
  - Internally, the ref is resolved via `getByRole(...)` (plus `nth()` for duplicates).
  - Add `"labels": true` to include a viewport screenshot with overlayed `e12` labels.

Ref behavior:

- Refs are **not stable across navigations**; if something fails, re-run `snapshot` and use a fresh ref.
- If the role snapshot was taken with `--frame`, role refs are scoped to that iframe until the next role snapshot.

## Wait power-ups

You can wait on more than just time/text:

- Wait for URL (globs supported by Playwright):
  - `{ "action": "act", "kind": "wait", "url": "**/dash" }`
- Wait for load state:
  - `{ "action": "act", "kind": "wait", "loadState": "networkidle" }`
- Wait for a JS predicate:
  - `{ "action": "act", "kind": "wait", "fn": "window.ready===true" }`
- Wait for a selector to become visible:
  - `{ "action": "act", "kind": "wait", "selector": "#main" }`

These can be combined:

```json
{
  "action": "act",
  "kind": "wait",
  "selector": "#main",
  "url": "**/dash",
  "loadState": "networkidle",
  "fn": "window.ready===true",
  "timeoutMs": 15000
}
```

## Debug workflows

When an action fails (e.g. “not visible”, “strict mode violation”, “covered”):

1. Run `{ "action": "snapshot", "interactive": true }`.
2. Use `{ "action": "act", "kind": "click", "ref": "<ref>" }` or `{ "action": "act", "kind": "type", "ref": "<ref>", "text": "..." }`.
3. If the page behaves oddly, inspect `{ "action": "console", "level": "error" }` and `{ "action": "network", "pattern": "api" }`.

## Structured output

Agent tool calls and `/tools/invoke` responses are already structured JSON.
Useful direct calls include:

```json
{ "action": "status" }
```

```json
{ "action": "snapshot", "interactive": true }
```

```json
{ "action": "network", "pattern": "api" }
```

```json
{ "action": "cookies" }
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

- The CrawClaw Desktop or the local Gateway API.
- `browser` tool evaluate actions and `wait` calls with `fn`
  execute arbitrary JavaScript in the page context. Prompt injection can steer
  this. Disable it with `browser.evaluateEnabled=false` if you do not need it.
- For logins and anti-bot notes (X/Twitter, etc.), see [Browser login + X/Twitter posting](/tools/browser-login).
- Keep the Gateway private (loopback or tailnet-only).
- Browser automation can operate inside signed-in sessions; keep managed
  profiles private.

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

## Agent tools + how control works

The agent gets **one tool** for browser automation:

- `browser` — status/start/stop/tabs/open/focus/close/snapshot/screenshot/navigate/act

How it maps:

- `browser snapshot` returns a stable UI tree (AI or ARIA).
- `browser act` uses the snapshot `ref` IDs to click/type/drag/select.
- `browser screenshot` captures pixels (full page or element).
- `browser` accepts:
  - `profile` to choose a named browser profile (`crawclaw`, `user`, or another configured profile).
  - `target` (`host`) to select the Gateway host browser.

This keeps the agent deterministic and avoids brittle selectors.

## Related

- [Tools Overview](/tools) — all available agent tools
- [Security](/gateway/security) — browser control risks and hardening
