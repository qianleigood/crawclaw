---
title: "Building Plugins"
sidebarTitle: "Getting Started"
summary: "Create your first CrawClaw plugin in minutes"
read_when:
  - You want to create a new CrawClaw plugin
  - You need a quick-start for plugin development
  - You are adding a new channel, provider, tool, or other capability to CrawClaw
---

# Building Plugins

Plugins extend CrawClaw with new capabilities: channels, model providers, speech,
image generation, web search, agent tools, or any combination.

You do not need to add your plugin to the CrawClaw repository. Publish to
[ClawHub](/tools/clawhub) or npm and users install with
CrawClaw Desktop or the local Gateway API. CrawClaw tries ClawHub first and
falls back to npm automatically.

## Prerequisites

- Node >= 22 and a package manager (npm or pnpm)
- Familiarity with TypeScript (ESM)
- For in-repo plugins: repository cloned and `pnpm install` done

## What kind of plugin?

<CardGroup cols={2}>
  <Card title="Provider plugin" icon="cpu" href="/plugins/sdk-provider-plugins">
    Add a model provider (LLM, proxy, or custom endpoint)
  </Card>
  <Card title="Tool / hook plugin" icon="wrench">
    Register agent tools, event hooks, or services — continue below
  </Card>
</CardGroup>

## Quick start: tool plugin

This walkthrough creates a minimal plugin that registers an agent tool. Channel
and provider plugins have dedicated guides linked above.

<Steps>
  <Step title="Create the package and manifest">
    <CodeGroup>
    ```json package.json
    {
      "name": "@myorg/crawclaw-my-plugin",
      "version": "1.0.0",
      "type": "module",
      "crawclaw": {
        "extensions": ["./index.ts"],
        "compat": {
          "pluginApi": ">=2026.3.24-beta.2",
          "minGatewayVersion": "2026.3.24-beta.2"
        },
        "build": {
          "crawclawVersion": "2026.3.24-beta.2",
          "pluginSdkVersion": "2026.3.24-beta.2"
        }
      }
    }
    ```

    ```json crawclaw.plugin.json
    {
      "id": "my-plugin",
      "name": "My Plugin",
      "description": "Adds a custom tool to CrawClaw",
      "configSchema": {
        "type": "object",
        "additionalProperties": false
      }
    }
    ```
    </CodeGroup>

    Every plugin needs a manifest, even with no config. See
    [Manifest](/plugins/manifest) for the full schema. The canonical ClawHub
    publish snippets live in `docs/snippets/plugin-publish/`.

  </Step>

  <Step title="Write the entry point">

    ```typescript
    // index.ts
    import { definePluginEntry } from "crawclaw/plugin-sdk/plugin-entry";
    import { Type } from "@sinclair/typebox";

    export default definePluginEntry({
      id: "my-plugin",
      name: "My Plugin",
      description: "Adds a custom tool to CrawClaw",
      register(api) {
        api.registerTool({
          name: "my_tool",
          description: "Do a thing",
          parameters: Type.Object({ input: Type.String() }),
          async execute(_id, params) {
            return { content: [{ type: "text", text: `Got: ${params.input}` }] };
          },
        });
      },
    });
    ```

    `definePluginEntry` is for provider, tool, hook, command, service, speech,
    media, and web plugins. TypeScript channel plugins are no longer a
    production contract; channels are implemented as Rust-native adapters. For
    full entry point options, see [Entry Points](/plugins/sdk-entrypoints).

  </Step>

  <Step title="Test and publish">

    **External plugins:** validate and publish with ClawHub, then install:

    ```bash
    clawhub package publish your-org/your-plugin --dry-run
    clawhub package publish your-org/your-plugin
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    CrawClaw also checks ClawHub before npm for bare package specs like
    `@myorg/crawclaw-my-plugin`.

    **In-repo plugins:** place under the bundled plugin workspace tree — automatically discovered.

    ```bash
    pnpm test -- <bundled-plugin-root>/my-plugin/
    ```

  </Step>
</Steps>

## Plugin capabilities

A single plugin can register any number of capabilities via the `api` object:

| Capability            | Registration method                           | Detailed guide                                            |
| --------------------- | --------------------------------------------- | --------------------------------------------------------- |
| Local process backend | `api.registerCliBackend(...)`                 | [Local Process Backends](/gateway/local-process-backends) |
| Speech (TTS/STT)      | `api.registerSpeechProvider(...)`             | [SDK Overview](/plugins/sdk-overview)                     |
| Media understanding   | `api.registerMediaUnderstandingProvider(...)` | [SDK Overview](/plugins/sdk-overview)                     |
| Web search            | `api.registerWebSearchProvider(...)`          | [SDK Overview](/plugins/sdk-overview)                     |
| Agent tools           | `api.registerTool(...)`                       | Below                                                     |
| Custom commands       | `api.registerCommand(...)`                    | [Entry Points](/plugins/sdk-entrypoints)                  |
| HTTP routes           | `api.registerHttpRoute(...)`                  | [Internals](/plugins/architecture#gateway-http-routes)    |

For the full registration API, see [SDK Overview](/plugins/sdk-overview#registration-api).

## Registering agent tools

Tools are typed functions the LLM can call. They can be required (always
available) or optional (user opt-in):

```typescript
register(api) {
  // Required tool — always available
  api.registerTool({
    name: "my_tool",
    description: "Do a thing",
    parameters: Type.Object({ input: Type.String() }),
    async execute(_id, params) {
      return { content: [{ type: "text", text: params.input }] };
    },
  });

  // Optional tool — user must add to allowlist
  api.registerTool(
    {
      name: "workflow_tool",
      description: "Run a workflow",
      parameters: Type.Object({ pipeline: Type.String() }),
      async execute(_id, params) {
        return { content: [{ type: "text", text: params.pipeline }] };
      },
    },
    { optional: true },
  );
}
```

Users enable optional tools in config:

```json5
{
  tools: { allow: ["workflow_tool"] },
}
```

- Tool names must not clash with core tools (conflicts are skipped)
- Use `optional: true` for tools with side effects or extra binary requirements
- Users can enable all tools from a plugin by adding the plugin id to `tools.allow`

## Import conventions

Always import from focused `crawclaw/plugin-sdk/<subpath>` paths:

```typescript
import { definePluginEntry } from "crawclaw/plugin-sdk/plugin-entry";
import { createPluginRuntimeStore } from "crawclaw/plugin-sdk/runtime-store";

// Wrong: removed monolithic root entry
import { ... } from "crawclaw/plugin-sdk";
```

For the full subpath reference, see [SDK Overview](/plugins/sdk-overview).

Within your plugin, use local barrel files (`api.ts`, `runtime-api.ts`) for
internal imports — never import your own plugin through its SDK path.

## Pre-submission checklist

<Check>**package.json** has correct `crawclaw` metadata</Check>
<Check>**crawclaw.plugin.json** manifest is present and valid</Check>
<Check>Entry point uses `definePluginEntry`</Check>
<Check>All imports use focused `plugin-sdk/<subpath>` paths</Check>
<Check>Internal imports use local modules, not SDK self-imports</Check>
<Check>Tests pass (`pnpm test -- <bundled-plugin-root>/my-plugin/`)</Check>
<Check>`pnpm check` passes (in-repo plugins)</Check>

## Beta Release Testing

1. Watch for GitHub release tags on [crawclaw/crawclaw](https://github.com/qianleigood/crawclaw/releases) and subscribe via `Watch` > `Releases`. Beta tags look like `v2026.3.N-beta.1`. You can also turn on notifications for the official CrawClaw X account [@crawclaw](https://x.com/crawclaw) for release announcements.
2. Test your plugin against the beta tag as soon as it appears. The window before stable is typically only a few hours.
3. Post in your plugin's thread in the `plugin-forum` community chat channel after testing with either `all good` or what broke. If you do not have a thread yet, create one.
4. If something breaks, open or update an issue titled `Beta blocker: <plugin-name> - <summary>` and apply the `beta-blocker` label. Put the issue link in your thread.
5. Open a PR to `main` titled `fix(<plugin-id>): beta blocker - <summary>` and link the issue in both the PR and your community chat thread. Contributors cannot label PRs, so the title is the PR-side native channel for maintainers and automation. Blockers with a PR get merged; blockers without one might ship anyway. Maintainers watch these threads during beta testing.
6. Silence means green. If you miss the window, your fix likely lands in the next cycle.

## Next steps

<CardGroup cols={2}>
  <Card title="Provider Configuration" icon="cpu" href="/plugins/sdk-provider-plugins">
    Configure Rust-owned model providers
  </Card>
  <Card title="SDK Overview" icon="book-open" href="/plugins/sdk-overview">
    Import map and registration API reference
  </Card>
  <Card title="Runtime Helpers" icon="settings" href="/plugins/sdk-runtime">
    TTS, search, subagent via api.runtime
  </Card>
  <Card title="Testing" icon="test-tubes" href="/plugins/sdk-testing">
    Test utilities and patterns
  </Card>
  <Card title="Plugin Manifest" icon="file-json" href="/plugins/manifest">
    Full manifest schema reference
  </Card>
</CardGroup>

## Related

- [Plugin Architecture](/plugins/architecture) — internal architecture deep dive
- [SDK Overview](/plugins/sdk-overview) — Plugin SDK reference
- [Manifest](/plugins/manifest) — plugin manifest format
- [Provider Configuration](/plugins/sdk-provider-plugins) — Rust-owned providers and custom provider config
