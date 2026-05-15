---
title: "Plugin SDK Overview"
sidebarTitle: "SDK Overview"
summary: "Import map, registration API reference, and SDK architecture"
read_when:
  - You need to know which SDK subpath to import from
  - You want a reference for all registration methods on CrawClawPluginApi
  - You are looking up a specific SDK export
---

# Plugin SDK Overview

The plugin SDK is the typed contract between plugins and core. This page is the
reference for **what to import** and **what you can register**.

<Tip>
  **Looking for a how-to guide?**
  - First plugin? Start with [Getting Started](/plugins/building-plugins)
  - Model provider config? See [Provider Configuration](/plugins/sdk-provider-plugins)
</Tip>

## Import convention

Always import from a specific subpath:

```typescript
import { definePluginEntry } from "crawclaw/plugin-sdk/plugin-entry";
```

Each subpath is a small, self-contained module. This keeps startup fast and
prevents circular dependency issues.

## Subpath reference

The most commonly used subpaths, grouped by purpose. The full list of 100+
subpaths is in `scripts/lib/plugin-sdk-entrypoints.json`.

### Plugin entry

| Subpath                   | Key exports                                          |
| ------------------------- | ---------------------------------------------------- |
| `plugin-sdk/plugin-entry` | `definePluginEntry`                                  |
| `plugin-sdk/core`         | Generic plugin entry types and shared plugin helpers |

TypeScript channel SDK subpaths have been removed. Channel plugins should use the Rust-native
channel plugin contract.

<AccordionGroup>

  <Accordion title="Provider and web capability subpaths">
    | Subpath | Key exports |
    | --- | --- |
    | `plugin-sdk/local-process-backend` | local process backend defaults + watchdog constants |
    | `plugin-sdk/provider-usage` | `fetchClaudeUsage` and similar |
    | `plugin-sdk/provider-web-fetch` | Web fetch provider helpers |
    | `plugin-sdk/provider-web-search` | Web search provider helpers |
    | `plugin-sdk/global-singleton` | Process-local singleton/map/cache helpers |
  </Accordion>

  <Accordion title="Auth and security subpaths">
    | Subpath | Key exports |
    | --- | --- |
    | `plugin-sdk/command-auth` | `resolveControlCommandGate` |
    | `plugin-sdk/allow-from` | `formatAllowFromLowercase` |
    | `plugin-sdk/secret-input` | Secret input parsing helpers |
    | `plugin-sdk/webhook-ingress` | Webhook request/target helpers |
    | `plugin-sdk/webhook-request-guards` | Request body size/timeout helpers |
  </Accordion>

  <Accordion title="Runtime and storage subpaths">
    | Subpath | Key exports |
    | --- | --- |
    | `plugin-sdk/runtime-store` | `createPluginRuntimeStore` |
    | `plugin-sdk/config-runtime` | Config load/write helpers |
    | `plugin-sdk/approval-runtime` | Exec/plugin approval helpers, approval-capability builders, auth/profile helpers, native routing/runtime helpers |
    | `plugin-sdk/infra-runtime` | System event and main-session wake helpers |
    | `plugin-sdk/collection-runtime` | Small bounded cache helpers |
    | `plugin-sdk/diagnostic-runtime` | Diagnostic flag and event helpers |
    | `plugin-sdk/error-runtime` | Error graph and formatting helpers |
    | `plugin-sdk/fetch-runtime` | Wrapped fetch, proxy, and pinned lookup helpers |
    | `plugin-sdk/host-runtime` | Hostname and SCP host normalization helpers |
    | `plugin-sdk/retry-runtime` | Retry config and retry runner helpers |
    | `plugin-sdk/agent-runtime` | Agent dir/identity/workspace helpers |
    | `plugin-sdk/directory-runtime` | Config-backed directory query/dedup |
    | `plugin-sdk/keyed-async-queue` | `KeyedAsyncQueue` |
  </Accordion>

  <Accordion title="Capability and testing subpaths">
    | Subpath | Key exports |
    | --- | --- |
    | `plugin-sdk/media-understanding` | Media understanding provider types |
    | `plugin-sdk/speech` | Speech provider types |
    | `plugin-sdk/testing` | `installCommonResolveTargetErrorCases`, `shouldAckReaction` |
  </Accordion>
</AccordionGroup>

## Registration API

The `register(api)` callback receives an `CrawClawPluginApi` object with these
methods:

### Capability registration

| Method                                        | What it registers              |
| --------------------------------------------- | ------------------------------ |
| `api.registerCliBackend(...)`                 | Local Local process backend    |
| `api.registerSpeechProvider(...)`             | Text-to-speech / STT synthesis |
| `api.registerMediaUnderstandingProvider(...)` | Image/audio/video analysis     |
| `api.registerWebSearchProvider(...)`          | Web search                     |

### Tools and commands

| Method                          | What it registers                             |
| ------------------------------- | --------------------------------------------- |
| `api.registerTool(tool, opts?)` | Agent tool (required or `{ optional: true }`) |
| `api.registerCommand(def)`      | Custom command (bypasses the LLM)             |

### Infrastructure

| Method                                     | What it registers     |
| ------------------------------------------ | --------------------- |
| `api.registerHttpRoute(params)`            | Gateway HTTP endpoint |
| `api.registerGatewayMethod(name, handler)` | Gateway RPC method    |
| `api.registerService(service)`             | Background service    |

### Desktop and Gateway actions

Plugin-owned user actions should be exposed through Desktop UI surfaces or
Gateway methods. Use `api.registerGatewayMethod(name, handler, opts?)` for
local automation and API control-plane operations.

### local process backend registration

`api.registerCliBackend(...)` lets a plugin own the default config for a local
AI local process backend such as `claude-cli` or `codex-cli`.

- The backend `id` becomes the provider prefix in model refs like `claude-cli/opus`.
- The backend `config` uses the same shape as `agents.defaults.cliBackends.<id>`.
- User config still wins. CrawClaw merges `agents.defaults.cliBackends.<id>` over the
  plugin default before running the CLI.
- Use `normalizeConfig` when a backend needs compatibility rewrites after merge
  (for example normalizing old flag shapes).

### Exclusive slots

CrawClaw no longer exposes a legacy context-engine registration API. The only
exclusive plugin slot still supported is `kind: "memory"` via plugin manifests.

### Memory embedding adapters

| Method | What it registers |
| ------ | ----------------- |

or more embedding adapter ids (for example `openai`, `gemini`, or a custom
plugin-defined id).

### Events

| Method                                       | What it does                  |
| -------------------------------------------- | ----------------------------- |
| `api.onConversationBindingResolved(handler)` | Conversation binding callback |

### API object fields

| Field                    | Type                      | Description                                               |
| ------------------------ | ------------------------- | --------------------------------------------------------- |
| `api.id`                 | `string`                  | Plugin id                                                 |
| `api.name`               | `string`                  | Display name                                              |
| `api.version`            | `string?`                 | Plugin version (optional)                                 |
| `api.description`        | `string?`                 | Plugin description (optional)                             |
| `api.source`             | `string`                  | Plugin source path                                        |
| `api.rootDir`            | `string?`                 | Plugin root directory (optional)                          |
| `api.config`             | `CrawClawConfig`          | Current config snapshot                                   |
| `api.pluginConfig`       | `Record<string, unknown>` | Plugin-specific config from `plugins.entries.<id>.config` |
| `api.runtime`            | `PluginRuntime`           | [Runtime helpers](/plugins/sdk-runtime)                   |
| `api.logger`             | `PluginLogger`            | Scoped logger (`debug`, `info`, `warn`, `error`)          |
| `api.registrationMode`   | `PluginRegistrationMode`  | `"full"`, `"setup-only"`, or `"setup-runtime"`            |
| `api.resolvePath(input)` | `(string) => string`      | Resolve path relative to plugin root                      |

## Internal module convention

Within your plugin, use local barrel files for internal imports:

```
my-plugin/
  api.ts            # Public exports for external consumers
  runtime-api.ts    # Internal-only runtime exports
  index.ts          # Plugin entry point
  setup-entry.ts    # Lightweight setup-only entry (optional)
```

<Warning>
  Never import your own plugin through `crawclaw/plugin-sdk/<your-plugin>`
  from production code. Route internal imports through `./api.ts` or
  `./runtime-api.ts`. The SDK path is the external contract only.
</Warning>

<Warning>
  Extension production code should also avoid `crawclaw/plugin-sdk/<other-plugin>`
  imports. If a helper is truly shared, promote it to a neutral SDK subpath
  such as `crawclaw/plugin-sdk/speech` or another capability-oriented surface
  instead of coupling two plugins together.
</Warning>

## Related

- [Entry Points](/plugins/sdk-entrypoints) — `definePluginEntry` options
- [Runtime Helpers](/plugins/sdk-runtime) — full `api.runtime` namespace reference
- [Setup and Config](/plugins/sdk-setup) — packaging, manifests, config schemas
- [Testing](/plugins/sdk-testing) — test utilities and lint rules
- [SDK Migration](/plugins/sdk-migration) — migrating from deprecated surfaces
- [Plugin Internals](/plugins/architecture) — deep architecture and capability model
