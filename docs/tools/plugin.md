---
summary: "Install, configure, and manage CrawClaw plugins"
read_when:
  - Installing or configuring plugins
  - Understanding plugin discovery and load rules
  - Working with Codex/Claude-compatible plugin bundles
title: "Plugins"
sidebarTitle: "Install and Configure"
---

# Plugins

Plugins extend CrawClaw with new capabilities: channels, model providers, tools,
skills, speech, image generation, and more. Some plugins are **core** (shipped
with CrawClaw), others are **external** (published on npm by the community).

## Quick start

<Steps>
  <Step title="See what is loaded">
    ```bash
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```
  </Step>

  <Step title="Install a plugin">
    ```bash
    # From npm
    # Use CrawClaw Desktop or the local Gateway API for this operation.

    # From a local directory or archive
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

  </Step>

  <Step title="Restart the Gateway">
    ```bash
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    Then configure under `plugins.entries.\<id\>.config` in your config file.

  </Step>
</Steps>

If you prefer chat-native control, enable `commands.plugins: true` and use:

```text
/plugin install clawhub:@org/plugin-name
/plugin show plugin-name
/plugin enable plugin-name
```

The install path uses the same resolver as the CLI: local path/archive, explicit
`clawhub:<pkg>`, or bare package spec (ClawHub first, then npm fallback).

## Plugin types

CrawClaw recognizes two plugin formats:

| Format     | How it works                                                       | Examples                                               |
| ---------- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| **Native** | `crawclaw.plugin.json` + runtime module; executes in-process       | Official plugins, community npm packages               |
| **Bundle** | Codex/Claude/Cursor-compatible layout; mapped to CrawClaw features | `.codex-plugin/`, `.claude-plugin/`, `.cursor-plugin/` |

Both show up under CrawClaw Desktop or the local Gateway API. See [Plugin Bundles](/plugins/bundles) for bundle details.

If you are writing a native plugin, start with [Building Plugins](/plugins/building-plugins)
and the [Plugin SDK Overview](/plugins/sdk-overview).

## Official plugins

### Core (shipped with CrawClaw)

<AccordionGroup>
  <Accordion title="Model providers (enabled by default)">
    `anthropic`, `byteplus`, `cloudflare-ai-gateway`, `github-copilot`, `google`,
    `huggingface`, `kilocode`, `kimi-coding`, `minimax`, `mistral`, `modelstudio`,
    `moonshot`, `nvidia`, `openai`, `opencode`, `opencode-go`, `openrouter`,
    `qianfan`, `synthetic`, `together`, `venice`,
    `vercel-ai-gateway`, `volcengine`, `xiaomi`, `zai`
  </Accordion>

  <Accordion title="Speech providers (enabled by default)">
    `qwen3-tts`
  </Accordion>

  <Accordion title="Other">
    - `copilot-proxy` — VS Code Copilot Proxy bridge (disabled by default)
  </Accordion>
</AccordionGroup>

Looking for third-party plugins? See [Community Plugins](/plugins/community).

## Configuration

```json5
{
  plugins: {
    enabled: true,
    allow: ["trusted-plugin"],
    deny: ["untrusted-plugin"],
    load: { paths: ["~/Projects/oss/crawclaw-plugin"] },
    entries: {
      "trusted-plugin": { enabled: true, config: {} },
    },
  },
}
```

| Field            | Description                              |
| ---------------- | ---------------------------------------- |
| `enabled`        | Master toggle (default: `true`)          |
| `allow`          | Plugin allowlist (optional)              |
| `deny`           | Plugin denylist (optional; deny wins)    |
| `load.paths`     | Extra plugin files/directories           |
| `slots`          | Exclusive slot selectors (e.g. `memory`) |
| `entries.\<id\>` | Per-plugin toggles + config              |

Config changes apply through Gateway live reconfigure. Native plugin descriptors
are re-read from the Rust runtime; CrawClaw no longer starts TypeScript plugin
services during desktop reconfigure.

<Accordion title="Plugin states: disabled vs missing vs invalid">
  - **Disabled**: plugin exists but enablement rules turned it off. Config is preserved.
  - **Missing**: config references a plugin id that discovery did not find.
  - **Invalid**: plugin exists but its config does not match the declared schema.
</Accordion>

## Discovery and precedence

CrawClaw scans for plugins in this order (first match wins):

<Steps>
  <Step title="Config paths">
    `plugins.load.paths` — explicit file or directory paths.
  </Step>

  <Step title="Workspace extensions">
    Manifest roots under `\<workspace\>/.crawclaw/<plugin-root>/` that contain
    `crawclaw.plugin.json`.
  </Step>

  <Step title="Global extensions">
    Manifest roots under `~/.crawclaw/<plugin-root>/` that contain
    `crawclaw.plugin.json`.
  </Step>

  <Step title="Bundled plugins">
    Shipped with CrawClaw. Many are enabled by default (model providers, speech).
    Others require explicit enablement.
  </Step>
</Steps>

### Enablement rules

- `plugins.enabled: false` disables all plugins
- `plugins.deny` always wins over allow
- `plugins.entries.\<id\>.enabled: false` disables that plugin
- Workspace-origin plugins are **disabled by default** (must be explicitly enabled)
- Bundled plugins follow the built-in default-on set unless overridden
- Exclusive slots can force-enable the selected plugin for that slot

## Plugin slots (exclusive categories)

Some categories are exclusive (only one active at a time):

```json5
{
  plugins: {
    slots: {
      memory: "none",
    },
  },
}
```

| Slot     | What it controls                       | Default |
| -------- | -------------------------------------- | ------- |
| `memory` | Exclusive memory-plugin selection path | `none`  |

## Gateway API reference

```bash
# Use CrawClaw Desktop or the local Gateway API for this operation.
# Use CrawClaw Desktop or the local Gateway API for this operation.
# Use CrawClaw Desktop or the local Gateway API for this operation.
# Use CrawClaw Desktop or the local Gateway API for this operation.
# Use CrawClaw Desktop or the local Gateway API for this operation.

# Use CrawClaw Desktop or the local Gateway API for this operation.
# Use CrawClaw Desktop or the local Gateway API for this operation.
# Use CrawClaw Desktop or the local Gateway API for this operation.
# Use CrawClaw Desktop or the local Gateway API for this operation.
# Use CrawClaw Desktop or the local Gateway API for this operation.
# Use CrawClaw Desktop or the local Gateway API for this operation.
# Use CrawClaw Desktop or the local Gateway API for this operation.

# Use CrawClaw Desktop or the local Gateway API for this operation.
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

`--dangerously-force-unsafe-install` is a break-glass override for false
positives from the built-in dangerous-code scanner. It allows installs to
continue past built-in `critical` findings, but it still does not bypass plugin
`before_install` policy blocks or scan-failure blocking.

This CLI flag applies to plugin installs only. Gateway-backed skill dependency
installs use the matching `dangerouslyForceUnsafeInstall` request override
instead, while CrawClaw Desktop or the local Gateway API remains the separate ClawHub skill
download/install flow.

See [CrawClaw Desktop or the local Gateway API Gateway API reference](/tools/plugin) for full details.

## Plugin API overview

Plugins are discovered from `crawclaw.plugin.json` and Rust native descriptors.
Package metadata stays declarative and non-executing; production runtime
behavior does not run through a TypeScript callback.

Common capability surfaces:

| Method                            | What it registers    |
| --------------------------------- | -------------------- |
| Rust native speech descriptor     | Text-to-speech / STT |
| Rust native media descriptor      | Image/audio analysis |
| Rust native web-search descriptor | Web search           |

Model providers, tools, commands, Gateway methods, services, HTTP handlers, and
typed lifecycle hooks are no longer TypeScript plugin API surfaces. Configure
custom LLM providers with `models.providers`; runtime capabilities are owned by
Rust.

## Related

- [Building Plugins](/plugins/building-plugins) — create your own plugin
- [Plugin Bundles](/plugins/bundles) — legacy bundle migration notes
- [Plugin Manifest](/plugins/manifest) — manifest schema
- [Plugin Internals](/plugins/architecture) — capability model and load pipeline
- [Community Plugins](/plugins/community) — third-party listings
