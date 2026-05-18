---
summary: "Install and use Codex, Claude, and Cursor bundles as CrawClaw plugins"
read_when:
  - You want to install a Codex, Claude, or Cursor-compatible bundle
  - You need to understand how CrawClaw maps bundle content into native features
  - You are debugging bundle detection or missing capabilities
title: "Plugin Bundles"
---

# Plugin Bundles

CrawClaw can install plugins from three external ecosystems: **Codex**, **Claude**,
and **Cursor**. These are called **bundles** — content and metadata packs that
CrawClaw maps into native features like skills, hooks, and MCP tools.

<Info>
  Bundles are **not** the same as native CrawClaw plugins. Native plugins run
  in-process and can register any capability. Bundles are content packs with
  selective feature mapping and a narrower trust boundary.
</Info>

## Why bundles exist

Many useful plugins are published in Codex, Claude, or Cursor format. Instead
of requiring authors to rewrite them as native CrawClaw plugins, CrawClaw
detects these formats and maps their supported content into the native feature
set. This means you can install a Claude command pack or a Codex skill bundle
and use it immediately.

## Install a bundle

<Steps>
  <Step title="Install from a directory, archive, or marketplace">
    ```bash
    # Local directory
    # Use CrawClaw Desktop or the local Gateway API for this operation.

    # Archive
    # Use CrawClaw Desktop or the local Gateway API for this operation.

    # Claude marketplace
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

  </Step>

  <Step title="Verify detection">
    ```bash
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    Bundles show as `Format: bundle` with a subtype of `codex`, `claude`, or `cursor`.

  </Step>

  <Step title="Restart and use">
    ```bash
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    Mapped features (skills, hooks, MCP tools) are available in the next session.

  </Step>
</Steps>

## What CrawClaw maps from bundles

Not every bundle feature runs in CrawClaw today. Here is what works and what
is detected but not yet wired.

### Supported now

| Feature       | How it maps                                                                             | Applies to     |
| ------------- | --------------------------------------------------------------------------------------- | -------------- |
| Skill content | Bundle skill roots load as normal CrawClaw skills                                       | All formats    |
| Commands      | `commands/` and `.cursor/commands/` treated as skill roots                              | Claude, Cursor |
| Hook packs    | CrawClaw-style `HOOK.md` + `handler.ts` layouts                                         | Codex          |
| MCP tools     | Bundle MCP config merged into runtime settings; supported stdio and HTTP servers loaded | All formats    |
| Settings      | Claude `settings.json` imported as sanitized runtime defaults                           | Claude         |

#### Skill content

- bundle skill roots load as normal CrawClaw skill roots
- Claude `commands` roots are treated as additional skill roots
- Cursor `.cursor/commands` roots are treated as additional skill roots

This means Claude markdown command files work through the normal CrawClaw skill
loader. Cursor command markdown works through the same path.

#### Hook modules

- bundle hook roots work **only** when they use the normal CrawClaw hook module
  layout. Today this is primarily the Codex-compatible case:
  - `HOOK.md`
  - `handler.ts` or `handler.js`

#### Runtime MCP

- enabled bundles can contribute MCP server config
- CrawClaw merges bundle MCP config into the effective runtime settings as
  `mcpServers`
- CrawClaw exposes supported bundle MCP tools during Rust agent turns by
  launching stdio servers or connecting to HTTP servers
- project-local runtime settings still apply after bundle defaults, so workspace
  settings can override bundle MCP entries when needed

##### Transports

MCP servers can use stdio or HTTP transport:

**Stdio** launches a child process:

```json
{
  "mcp": {
    "servers": {
      "my-server": {
        "command": "node",
        "args": ["server.js"],
        "env": { "PORT": "3000" }
      }
    }
  }
}
```

**HTTP** connects to a running MCP server over `sse` by default, or `streamable-http` when requested:

```json
{
  "mcp": {
    "servers": {
      "my-server": {
        "url": "http://localhost:3100/mcp",
        "transport": "streamable-http",
        "headers": {
          "Authorization": "Bearer ${MY_SECRET_TOKEN}"
        },
        "connectionTimeoutMs": 30000
      }
    }
  }
}
```

- `transport` may be set to `"streamable-http"` or `"sse"`; when omitted, CrawClaw uses `sse`
- only `http:` and `https:` URL schemes are allowed
- `headers` values support `${ENV_VAR}` interpolation
- a server entry with both `command` and `url` is rejected
- URL credentials (userinfo and query params) are redacted from tool
  descriptions and logs
- `connectionTimeoutMs` overrides the default 30-second connection timeout for
  both stdio and HTTP transports

##### Tool naming

CrawClaw registers bundle MCP tools with provider-safe names in the form
`serverName__toolName`. For example, a server keyed `"vigil-harbor"` exposing a
`search_notes` tool registers as `vigil-harbor__search_notes`.

- characters outside `A-Za-z0-9_-` are replaced with `-`
- server prefixes are capped at 30 characters
- full tool names are capped at 64 characters
- empty server names fall back to `mcp`
- colliding sanitized names are disambiguated with numeric suffixes

#### Runtime settings

- Claude `settings.json` is imported as default runtime settings when the
  bundle is enabled
- CrawClaw sanitizes shell override keys before applying them

Sanitized keys:

- `shellPath`
- `shellCommandPrefix`

### Detected but not executed

These are recognized and shown in diagnostics, but CrawClaw does not run them:

- Claude `agents`, `hooks.json` automation, `lspServers`, `outputStyles`
- Cursor `.cursor/agents`, `.cursor/hooks.json`, `.cursor/rules`
- Codex inline/app metadata beyond capability reporting

## Bundle formats

<AccordionGroup>
  <Accordion title="Codex bundles">
    Markers: `.codex-plugin/plugin.json`

    Optional content: `skills/`, `hooks/`, `.mcp.json`, `.app.json`

    Codex bundles fit CrawClaw best when they use skill roots and CrawClaw-style
    hook module directories (`HOOK.md` + `handler.ts`).

  </Accordion>

  <Accordion title="Claude bundles">
    Two detection modes:

    - **Manifest-based:** `.claude-plugin/plugin.json`
    - **Manifestless:** default Claude layout (`skills/`, `commands/`, `agents/`, `hooks/`, `.mcp.json`, `settings.json`)

    Claude-specific behavior:

    - `commands/` is treated as skill content
    - `settings.json` is imported into runtime settings (shell override keys are sanitized)
    - `.mcp.json` exposes supported stdio tools to the Rust agent runtime
    - `hooks/hooks.json` is detected but not executed
    - Custom component paths in the manifest are additive (they extend defaults, not replace them)

  </Accordion>

  <Accordion title="Cursor bundles">
    Markers: `.cursor-plugin/plugin.json`

    Optional content: `skills/`, `.cursor/commands/`, `.cursor/agents/`, `.cursor/rules/`, `.cursor/hooks.json`, `.mcp.json`

    - `.cursor/commands/` is treated as skill content
    - `.cursor/rules/`, `.cursor/agents/`, and `.cursor/hooks.json` are detect-only

  </Accordion>
</AccordionGroup>

## Detection precedence

CrawClaw checks for native plugin format first:

1. `crawclaw.plugin.json` — treated as **native plugin**
2. Bundle markers (`.codex-plugin/`, `.claude-plugin/`, or default Claude/Cursor layout) — treated as **bundle**

If a directory contains both, CrawClaw uses the native path. This prevents
dual-format packages from being partially installed as bundles.

## Security

Bundles have a narrower trust boundary than native plugins:

- CrawClaw does **not** load arbitrary bundle runtime modules in-process
- Skills and hook module paths must stay inside the plugin root (boundary-checked)
- Settings files are read with the same boundary checks
- Supported stdio MCP servers may be launched as subprocesses

This makes bundles safer by default, but you should still treat third-party
bundles as trusted content for the features they do expose.

## Troubleshooting

<AccordionGroup>
  <Accordion title="Bundle is detected but capabilities do not run">
    Run CrawClaw Desktop or the local Gateway API. If a capability is listed but marked as
    not wired, that is a product limit — not a broken install.
  </Accordion>

  <Accordion title="Claude command files do not appear">
    Make sure the bundle is enabled and the markdown files are inside a detected
    `commands/` or `skills/` root.
  </Accordion>

  <Accordion title="Claude settings do not apply">
    Only runtime settings from `settings.json` are supported. CrawClaw does
    not treat bundle settings as raw config patches.
  </Accordion>

  <Accordion title="Claude hooks do not execute">
    `hooks/hooks.json` is detect-only. If you need runnable hooks, use the
    CrawClaw hook module layout or ship a native plugin.
  </Accordion>
</AccordionGroup>

## Related

- [Install and Configure Plugins](/tools/plugin)
- [Building Plugins](/plugins/building-plugins) — create a native plugin
- [Plugin Manifest](/plugins/manifest) — native manifest schema
