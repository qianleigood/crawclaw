---
title: "Plugin SDK Migration"
sidebarTitle: "Migrate to SDK"
summary: "从已移除的 JavaScript SDK imports 迁移到 Rust plugin SDK"
read_when:
  - 你看到已移除 JavaScript plugin SDK imports 的 module-not-found error
  - 你看到 crawclaw/extension-api 的 module-not-found error
  - 你正在把 plugin 更新到 native plugin architecture
  - 你维护 external CrawClaw plugin
x-i18n:
  generated_at: "2026-06-10T11:33:25Z"
  model: codex
  provider: openai
  source_hash: 9d4ea848f3e9178345332f0967ca7dc57a58f90554b491359dadae0b0e4bb8ff
  source_path: plugins/sdk-migration.md
  workflow: 15
---

# Plugin SDK Migration

CrawClaw 已移除 public JavaScript 和 TypeScript plugin SDK exports。当前支持的 plugin authoring surface 是 Rust crate `crawclaw-plugin-sdk`，以及 plugin manifests 和 native runtime descriptors。

## What changed

npm package 不再导出 JavaScript plugin SDK subpaths 或 compatibility bridges。导入这些已移除路径的 plugins 会在当前 CrawClaw versions 上加载失败。

旧 helper files 不再是 runtime bridge 或 public SDK。当前 packages 应依赖 manifests 加 Rust native descriptors。

## How to migrate

<Steps>
  <Step title="Find removed imports">
    Search your plugin for old JavaScript SDK and extension bridge imports:

    ```bash
    rg "crawclaw/plugin-sdk|crawclaw/extension-api" my-plugin/
    ```

  </Step>

  <Step title="Move runtime behavior to Rust">
    Define plugin metadata with `NativePluginDescriptor` and capability helpers
    from `crawclaw-plugin-sdk`.

    ```rust
    use crawclaw_plugin_sdk::{
        NativeInvocationTarget, NativePluginDescriptor, NativeToolDescriptor,
    };

    let descriptor = NativePluginDescriptor::new("my-plugin").tool(
        NativeToolDescriptor::new(
            "run",
            NativeInvocationTarget::new("my-plugin", "run"),
        ),
    );
    ```

  </Step>

  <Step title="Keep manifest metadata explicit">
    Keep install, setup, and capability metadata in `crawclaw.plugin.json` and
    package metadata. Do not depend on JavaScript module execution for discovery.
  </Step>

  <Step title="Test the native surface">
    ```bash
    cargo test -q -p crawclaw-plugin-sdk
    cargo test -q -p crawclaw-native-plugins
    cargo test -q -p crawclaw-runtime
    cargo test -q -p crawclaw-gateway
    ```
  </Step>
</Steps>

## Removal timeline

| When    | What happens                                                          |
| ------- | --------------------------------------------------------------------- |
| Current | JavaScript plugin SDK exports are removed from the npm package        |
| Current | Desktop packages reject JavaScript plugin SDK runtime artifacts       |
| Current | New public plugin-facing helpers must be added to the Rust plugin SDK |

## Related

- [Getting Started](/plugins/building-plugins) -- build a native plugin
- [SDK Overview](/plugins/sdk-overview) -- Rust SDK reference
- [Provider Configuration](/plugins/sdk-provider-plugins) -- Rust-owned provider setup
- [Plugin Internals](/plugins/architecture) -- architecture deep dive
- [Plugin Manifest](/plugins/manifest) -- manifest schema reference
