---
summary: "Legacy browser CLI URL; current browser automation uses the agent browser tool"
read_when:
  - You followed an old `crawclaw browser` link
  - You need the current browser automation entrypoint
title: "browser"
---

# Browser automation

`crawclaw browser` is not registered as a standalone CLI command in current
CrawClaw builds. Browser automation is exposed as the agent `browser` tool from
the bundled browser plugin.

Current entrypoints:

- In an agent session, use the `browser` tool or inspect available tools with `/tools`.
- For direct automation, call the Gateway [Tools Invoke API](/gateway/tools-invoke-http-api) with `tool: "browser"`.
- Configure profiles, routing, and PinchTab behavior in [Browser tool](/tools/browser).

## Tool quick start

When calling the tool directly through `/tools/invoke`, put these fields under
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

```json
{ "action": "act", "profile": "crawclaw", "kind": "click", "ref": "e12" }
```

## Migration from old examples

Use the tool argument instead of the old CLI form:

| Old CLI form                    | Current `browser` tool args                                        |
| ------------------------------- | ------------------------------------------------------------------ |
| `crawclaw browser status`       | `{ "action": "status" }`                                           |
| `crawclaw browser profiles`     | `{ "action": "profiles" }`                                         |
| `crawclaw browser tabs`         | `{ "action": "tabs" }`                                             |
| `crawclaw browser open <url>`   | `{ "action": "open", "url": "<url>" }`                             |
| `crawclaw browser snapshot`     | `{ "action": "snapshot" }`                                         |
| `crawclaw browser click <ref>`  | `{ "action": "act", "kind": "click", "ref": "<ref>" }`             |
| `crawclaw browser type <ref> x` | `{ "action": "act", "kind": "type", "ref": "<ref>", "text": "x" }` |

The old `--browser-profile <name>` flag maps to the tool's `profile` argument.
Use `target` (`sandbox`, `host`, or `node`) when you need to pin where the
browser runs.

## If the browser tool is missing

If the agent reports that the `browser` tool is unavailable, check
`plugins.allow` in `~/.crawclaw/crawclaw.json`.

When `plugins.allow` is present, the bundled browser plugin must be listed
explicitly:

```json5
{
  plugins: {
    allow: ["telegram", "browser"],
  },
}
```

`browser.enabled=true` does not load the plugin when the plugin allowlist
excludes `browser`.

Related: [Browser tool](/tools/browser#missing-browser-tool)

## Remote browser control

If the Gateway runs on a different machine than the browser, run a **node host**
on the machine that has Chrome/Brave/Edge/Chromium. The Gateway can proxy
`browser` tool actions to that node.

Use `gateway.nodes.browser.mode` to control auto-routing and
`gateway.nodes.browser.node` to pin a specific node if multiple are connected.

Security + remote setup: [Browser tool](/tools/browser), [Remote access](/gateway/remote), [Tailscale](/gateway/tailscale), [Security](/gateway/security)
