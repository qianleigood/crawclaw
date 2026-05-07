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
    crawclaw plugins list
    ```
  </Step>

  <Step title="Install a plugin">
    ```bash
    # From npm
    crawclaw plugins install @crawclaw/voice-call

    # From a local directory or archive
    crawclaw plugins install ./my-plugin
    crawclaw plugins install ./my-plugin.tgz
    ```

  </Step>

  <Step title="Restart the Gateway">
    ```bash
    crawclaw gateway restart
    ```

    Then configure under `plugins.entries.\<id\>.config` in your config file.

  </Step>
</Steps>

If you prefer chat-native control, enable `commands.plugins: true` and use:

```text
/plugin install clawhub:@crawclaw/voice-call
/plugin show voice-call
/plugin enable voice-call
```

The install path uses the same resolver as the CLI: local path/archive, explicit
`clawhub:<pkg>`, or bare package spec (ClawHub first, then npm fallback).

## Plugin types

CrawClaw recognizes two plugin formats:

| Format     | How it works                                                       | Examples                                               |
| ---------- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| **Native** | `crawclaw.plugin.json` + runtime module; executes in-process       | Official plugins, community npm packages               |
| **Bundle** | Codex/Claude/Cursor-compatible layout; mapped to CrawClaw features | `.codex-plugin/`, `.claude-plugin/`, `.cursor-plugin/` |

Both show up under `crawclaw plugins list`. See [Plugin Bundles](/plugins/bundles) for bundle details.

If you are writing a native plugin, start with [Building Plugins](/plugins/building-plugins)
and the [Plugin SDK Overview](/plugins/sdk-overview).

## Official plugins

### Installable (npm)

| Plugin          | Package                | Docs                                 |
| --------------- | ---------------------- | ------------------------------------ |
| Matrix          | `@crawclaw/matrix`     | [Matrix](/channels/matrix)           |
| Microsoft Teams | `@crawclaw/msteams`    | [Microsoft Teams](/channels/msteams) |
| Nostr           | `@crawclaw/nostr`      | [Nostr](/channels/nostr)             |
| Voice Call      | `@crawclaw/voice-call` | [Voice Call](/plugins/voice-call)    |
| Zalo            | `@crawclaw/zalo`       | [Zalo](/channels/zalo)               |
| Zalo Personal   | `@crawclaw/zalouser`   | [Zalo Personal](/plugins/zalouser)   |

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
    `elevenlabs`, `microsoft`
  </Accordion>

  <Accordion title="Other">
    - `browser` — bundled browser plugin for the `browser` tool and the PinchTab-backed host/sandbox/node browser routing path (enabled by default; disable before replacing it)
    - `copilot-proxy` — VS Code Copilot Proxy bridge (disabled by default)
  </Accordion>
</AccordionGroup>

Looking for third-party plugins? See [Community Plugins](/plugins/community).

## Configuration

```json5
{
  plugins: {
    enabled: true,
    allow: ["voice-call"],
    deny: ["untrusted-plugin"],
    load: { paths: ["~/Projects/oss/voice-call-extension"] },
    entries: {
      "voice-call": { enabled: true, config: { provider: "twilio" } },
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

Config changes apply through Gateway live reconfigure. Plugins that implement a
dedicated reconfigure hook receive the new config directly; older plugin services
fall back to stop/start without restarting the Gateway process.

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
    `\<workspace\>/.crawclaw/<plugin-root>/*.ts` and `\<workspace\>/.crawclaw/<plugin-root>/*/index.ts`.
  </Step>

  <Step title="Global extensions">
    `~/.crawclaw/<plugin-root>/*.ts` and `~/.crawclaw/<plugin-root>/*/index.ts`.
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

## CLI reference

```bash
crawclaw plugins list                    # compact inventory
crawclaw plugins inspect <id>            # deep detail
crawclaw plugins inspect <id> --json     # machine-readable
crawclaw plugins status                  # operational summary
crawclaw plugins doctor                  # diagnostics

crawclaw plugins install <package>        # install (ClawHub first, then npm)
crawclaw plugins install clawhub:<pkg>   # install from ClawHub only
crawclaw plugins install <path>          # install from local path
crawclaw plugins install -l <path>       # link (no copy) for dev
crawclaw plugins install <spec> --dangerously-force-unsafe-install
crawclaw plugins update <id>             # update one plugin
crawclaw plugins update --all            # update all

crawclaw plugins enable <id>
crawclaw plugins disable <id>
```

`--dangerously-force-unsafe-install` is a break-glass override for false
positives from the built-in dangerous-code scanner. It allows installs to
continue past built-in `critical` findings, but it still does not bypass plugin
`before_install` policy blocks or scan-failure blocking.

This CLI flag applies to plugin installs only. Gateway-backed skill dependency
installs use the matching `dangerouslyForceUnsafeInstall` request override
instead, while `crawclaw skills install` remains the separate ClawHub skill
download/install flow.

See [`crawclaw plugins` CLI reference](/cli/plugins) for full details.

## Plugin API overview

Plugins export either a function or an object with `register(api)`:

```typescript
export default definePluginEntry({
  id: "my-plugin",
  name: "My Plugin",
  register(api) {
    api.registerProvider({
      /* ... */
    });
    api.registerTool({
      /* ... */
    });
    api.registerChannel({
      /* ... */
    });
  },
});
```

Common registration methods:

| Method                               | What it registers    |
| ------------------------------------ | -------------------- |
| `registerProvider`                   | Model provider (LLM) |
| `registerChannel`                    | Chat channel         |
| `registerTool`                       | Agent tool           |
| `registerHook` / `on(...)`           | Lifecycle hooks      |
| `registerSpeechProvider`             | Text-to-speech / STT |
| `registerMediaUnderstandingProvider` | Image/audio analysis |
| `registerWebSearchProvider`          | Web search           |
| `registerHttpRoute`                  | HTTP endpoint        |
| `registerCommand` / `registerCli`    | CLI commands         |
| `registerService`                    | Background service   |

Hook guard behavior for typed lifecycle hooks:

- `before_tool_call`: `{ block: true }` is terminal; lower-priority handlers are skipped.
- `before_tool_call`: `{ block: false }` is a no-op and does not clear an earlier block.
- `before_tool_call`: hook context includes runtime-derived `guard` state; task-backed agent runs can also expose persisted capability details via `guard.capability`.
- `before_install`: `{ block: true }` is terminal; lower-priority handlers are skipped.
- `before_install`: `{ block: false }` is a no-op and does not clear an earlier block.
- `message_sending`: `{ cancel: true }` is terminal; lower-priority handlers are skipped.
- `message_sending`: `{ cancel: false }` is a no-op and does not clear an earlier cancel.

For full typed hook behavior, see [SDK Overview](/plugins/sdk-overview#hook-decision-semantics).

## Related

- [Building Plugins](/plugins/building-plugins) — create your own plugin
- [Plugin Bundles](/plugins/bundles) — Codex/Claude/Cursor bundle compatibility
- [Plugin Manifest](/plugins/manifest) — manifest schema
- [Registering Tools](/plugins/building-plugins#registering-agent-tools) — add agent tools in a plugin
- [Plugin Internals](/plugins/architecture) — capability model and load pipeline
- [Community Plugins](/plugins/community) — third-party listings
