---
title: "Building Plugins"
sidebarTitle: "Getting Started"
summary: "几分钟内创建你的第一个 CrawClaw plugin"
read_when:
  - 你想创建新的 CrawClaw plugin
  - 你需要 plugin development quick-start
  - 你正在为 CrawClaw 添加新的 channel、provider、tool 或其他 capability
x-i18n:
  generated_at: "2026-06-11T13:00:43Z"
  model: codex
  provider: openai
  source_hash: 8f63935deef3f8f8c443e6a083c9c211ea90f11498e35a811ca6822a46b654af
  source_path: plugins/building-plugins.md
  workflow: 15
---

# Building Plugins

Plugins 通过 declarative metadata 和 configuration 扩展 CrawClaw，用于 Rust-native capabilities，例如 model providers、speech、image generation 和 web search。

你不需要把 plugin 加进 CrawClaw repository。发布到 [ClawHub](/tools/clawhub) 或 npm，users 通过 CrawClaw Desktop 或本地 Gateway API 安装。CrawClaw 会先尝试 ClawHub，然后自动 fallback 到 npm。

## Prerequisites

- Node 24.x 或 Node 25.x 和 package manager（npm 或 pnpm）
- 熟悉 Rust native descriptors 和 JSON manifests
- 对于 in-repo plugins：已 clone repository，并完成 `pnpm install`

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

这个 walkthrough 会创建一个 minimal manifest plugin。Runtime execution 属于 Rust native capability code，而不是 TypeScript callbacks。

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
```

Install the published plugin through CrawClaw Desktop or the local Gateway API.

    CrawClaw also checks ClawHub before npm for bare package specs like
    `@myorg/crawclaw-my-plugin`.

    **In-repo plugins:** place under the bundled plugin workspace tree — automatically discovered.

    ```bash
    pnpm test -- <bundled-plugin-root>/my-plugin/
    ```

  </Step>
</Steps>

## Plugin capabilities

plugin 可以声明 metadata，并暴露 Rust-native capabilities：

| Capability          | Registration method    | Detailed guide                        |
| ------------------- | ---------------------- | ------------------------------------- |
| Speech (TTS/STT)    | Rust native descriptor | [SDK Overview](/plugins/sdk-overview) |
| Media understanding | Rust native descriptor | [SDK Overview](/plugins/sdk-overview) |
| Web search          | Rust native descriptor | [SDK Overview](/plugins/sdk-overview) |

当前 Rust SDK surface 参见 [SDK Overview](/plugins/sdk-overview)。

## Runtime capabilities

TypeScript plugins 不再注册 production tools、commands、gateway methods、HTTP routes 或 background services。新的 runtime capabilities 应在 Rust 中添加，并通过 manifest 或 Rust native plugin registry 暴露 configuration。

## SDK conventions

Author-facing runtime helpers 位于 Rust crate `crawclaw-plugin-sdk`。不要添加或导入 JavaScript plugin SDK package subpaths。如果 package 仍需要 TypeScript 做 setup 或 packaging，把这些 helpers 保持为 package 私有，并通过 Rust native descriptors 暴露 runtime behavior。

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
