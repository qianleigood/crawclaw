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

Plugins extend CrawClaw with declarative metadata and configuration for
Rust-native capabilities such as model providers, speech, image generation, and
web search.

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
  <Card title="Native capability plugin" icon="wrench">
    Describe Rust-native capabilities — continue below
  </Card>
</CardGroup>

## Quick start: metadata plugin

This walkthrough creates a minimal manifest plugin. Runtime execution belongs in
Rust native capability code, not TypeScript callbacks.

<Steps>
  <Step title="Create the package and manifest">
    <CodeGroup>
    ```json package.json
    {
      "name": "@myorg/crawclaw-my-plugin",
      "version": "1.0.0",
      "type": "module",
      "crawclaw": {
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
      "native": {
        "protocol": "crawclaw-native-plugin-jsonrpc",
        "schemaVersion": 1,
        "bin": "./target/release/my-plugin"
      },
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

  <Step title="Implement the native runtime">

    Implement runtime behavior in Rust and expose it through the native plugin
    protocol declared in `crawclaw.plugin.json`. Do not add TypeScript runtime
    entry files.

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

A plugin can declare metadata and expose Rust-native capabilities:

| Capability          | Registration method    | Detailed guide                        |
| ------------------- | ---------------------- | ------------------------------------- |
| Speech (TTS/STT)    | Rust native descriptor | [SDK Overview](/plugins/sdk-overview) |
| Media understanding | Rust native descriptor | [SDK Overview](/plugins/sdk-overview) |
| Web search          | Rust native descriptor | [SDK Overview](/plugins/sdk-overview) |

For the current Rust SDK surface, see [SDK Overview](/plugins/sdk-overview).

## Runtime capabilities

TypeScript plugins no longer register production tools, commands, gateway
methods, HTTP routes, or background services. Add new runtime capabilities in
Rust and expose configuration through the manifest or the Rust native plugin
registry.

## SDK conventions

Author-facing runtime helpers live in the Rust crate `crawclaw-plugin-sdk`.
Do not add or import JavaScript plugin SDK package subpaths. If a package still
needs TypeScript for setup or packaging, keep those helpers private to the
package and expose runtime behavior through Rust native descriptors.

## Pre-submission checklist

<Check>**package.json** has correct `crawclaw` metadata</Check>
<Check>**crawclaw.plugin.json** manifest is present and valid</Check>
<Check>Runtime behavior is implemented by a Rust native descriptor</Check>
<Check>No public JavaScript plugin SDK imports remain</Check>
<Check>Internal imports use local modules or reviewed repo-private helper seams</Check>
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
    Rust SDK reference
  </Card>
  <Card title="Runtime Helpers" icon="settings" href="/plugins/sdk-runtime">
    Rust-owned runtime boundary
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
- [SDK Overview](/plugins/sdk-overview) — Rust SDK reference
- [Manifest](/plugins/manifest) — plugin manifest format
- [Provider Configuration](/plugins/sdk-provider-plugins) — Rust-owned providers and custom provider config
