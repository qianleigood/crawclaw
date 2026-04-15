---
summary: "CLI reference for `crawclaw browser` (PinchTab-backed browser automation)"
read_when:
  - You use `crawclaw browser` and want examples for common tasks
  - You want to control a browser running on another machine via a node host
title: "browser"
---

# `crawclaw browser`

Manage CrawClaw browser automation and run browser actions (tabs, snapshots, screenshots, navigation, clicks, typing).

Related:

- Browser tool + API: [Browser tool](/tools/browser)

## Common flags

- `--url <gatewayWsUrl>`: Gateway WebSocket URL (defaults to config).
- `--token <token>`: Gateway token (if required).
- `--timeout <ms>`: request timeout (ms).
- `--browser-profile <name>`: choose a browser profile (default from config).
- `--json`: machine-readable output (where supported).

## Quick start (local)

```bash
crawclaw browser profiles
crawclaw browser --browser-profile crawclaw start
crawclaw browser --browser-profile crawclaw open https://example.com
crawclaw browser --browser-profile crawclaw snapshot
```

## If the command is missing

If `crawclaw browser` is an unknown command, check `plugins.allow` in
`~/.crawclaw/crawclaw.json`.

When `plugins.allow` is present, the bundled browser plugin must be listed
explicitly:

```json5
{
  plugins: {
    allow: ["telegram", "browser"],
  },
}
```

`browser.enabled=true` does not restore the CLI subcommand when the plugin
allowlist excludes `browser`.

Related: [Browser tool](/tools/browser#missing-browser-command-or-tool)

## Profiles

Profiles are named browser routing configs. In practice:

- `crawclaw`: the default managed browser profile.
- additional profiles: named browser routes/config labels that still run through
  the bundled PinchTab-backed browser server.

If you migrated from an older CrawClaw install, you may still see the legacy
managed profile name `crawclaw` until you recreate or rename local browser
profiles.

```bash
crawclaw browser profiles
crawclaw browser create-profile --name work --color "#FF5A36"
crawclaw browser delete-profile --name work
```

Use a specific profile:

```bash
crawclaw browser --browser-profile work tabs
```

## Tabs

```bash
crawclaw browser tabs
crawclaw browser open https://docs.crawclaw.ai
crawclaw browser focus <targetId>
crawclaw browser close <targetId>
```

## Snapshot / screenshot / actions

Snapshot:

```bash
crawclaw browser snapshot
```

Screenshot:

```bash
crawclaw browser screenshot
```

Navigate/click/type (ref-based UI automation):

```bash
crawclaw browser navigate https://example.com
crawclaw browser click <ref>
crawclaw browser type <ref> "hello"
```

## Managed profiles

The bundled browser server standardizes on PinchTab-backed managed profiles.
Use `crawclaw browser create-profile --name <name>` to add another managed
profile with a distinct color/runtime identity.

## Remote browser control (node host proxy)

If the Gateway runs on a different machine than the browser, run a **node host** on the machine that has Chrome/Brave/Edge/Chromium. The Gateway will proxy browser actions to that node (no separate local compatibility service required).

Use `gateway.nodes.browser.mode` to control auto-routing and `gateway.nodes.browser.node` to pin a specific node if multiple are connected.

Security + remote setup: [Browser tool](/tools/browser), [Remote access](/gateway/remote), [Tailscale](/gateway/tailscale), [Security](/gateway/security)
