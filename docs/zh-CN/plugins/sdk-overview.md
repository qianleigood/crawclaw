---
title: "Plugin SDK Overview"
sidebarTitle: "SDK Overview"
summary: "Rust native plugin SDK architecture"
read_when:
  - 你需要编写 native CrawClaw plugin
  - 你正在查 Rust plugin descriptor surface
  - 你正在确认 native plugin runtime boundary
x-i18n:
  generated_at: "2026-06-10T11:33:25Z"
  model: codex
  provider: openai
  source_hash: cfb672f7770d306193b007e866c02005a25e60582cd978dc6fb60d1d5c1a0b27
  source_path: plugins/sdk-overview.md
  workflow: 15
---

# Plugin SDK Overview

CrawClaw 的 public plugin SDK 是 Rust crate `crawclaw-plugin-sdk`。旧 JavaScript 和 TypeScript SDK package exports 已移除。新的 plugins 应暴露 native descriptors，并通过 Rust-owned JSON-RPC 处理 runtime calls。

<Warning>
  npm package 不再导出 JavaScript plugin SDK subpaths。不要围绕 JavaScript SDK imports 构建新的 plugins。
</Warning>

## Authoring surface

使用 `crates/crawclaw-plugin-sdk` 获取 author-facing native types 和 helper builders：

```rust
use crawclaw_plugin_sdk::{
    NativeInvocationTarget, NativePluginDescriptor, NativeToolDescriptor,
    NativeToolResultEnvelope,
};

let descriptor = NativePluginDescriptor::new("example")
    .name("Example")
    .description("Example native plugin")
    .tool(
        NativeToolDescriptor::new("lookup", NativeInvocationTarget::new("example", "lookup"))
            .label("Lookup")
            .description("Look up an item")
            .read_only(true),
    );

let result = NativeToolResultEnvelope::text("done");
```

这些 helpers 包装现有 native wire types。它们不会改变 JSON field names 或 Gateway protocol shape。

## Runtime ownership

| Area                                          | Current owner                    |
| --------------------------------------------- | -------------------------------- |
| Manifest metadata                             | `crawclaw.plugin.json`           |
| Plugin descriptors                            | `crates/crawclaw-plugin-sdk`     |
| Bundled native plugin registry                | `crates/crawclaw-native-plugins` |
| Tools, services, providers, and Gateway calls | Rust runtime and Gateway crates  |
| Desktop packaged runtime                      | Native runtime binaries          |

TypeScript 和 JavaScript 仍可在需要时用于 desktop renderer 和 package metadata。它们不是 public plugin authoring SDK。

## Descriptor helpers

Rust SDK 包含这些 helpers：

- Plugin descriptors
- Tool descriptors
- Invocation targets
- Tool result envelopes
- Approval policy metadata
- JSON-RPC success and error responses

如果需要新的 plugin-facing capability，添加 additive Rust SDK helper，并保持 serialized shape 与当前 native protocol 兼容。

## Related

- [Getting Started](/plugins/building-plugins) -- manifest 和 native runtime setup
- [Runtime Boundary](/plugins/sdk-runtime) -- Rust-owned runtime model
- [Testing](/plugins/sdk-testing) -- Rust 和 contract test guidance
- [SDK Migration](/plugins/sdk-migration) -- 从已移除的 JS SDK imports 迁移
- [Plugin Internals](/plugins/architecture) -- architecture 和 capability model
