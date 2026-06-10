---
title: "Plugin Runtime Boundary"
sidebarTitle: "Runtime Boundary"
summary: "Rust-owned plugin runtime model"
read_when:
  - 你需要从 plugin 调用 runtime behavior
  - 你想了解 provider、tool、hook 或 channel code 在哪里运行
  - 你正在迁移旧 TypeScript plugin runtime code
x-i18n:
  generated_at: "2026-06-10T11:33:25Z"
  model: codex
  provider: openai
  source_hash: d8201ef02466d348a3bb9aa811393767d2dd7cab58bbf9771d735bfe9fd0199c
  source_path: plugins/sdk-runtime.md
  workflow: 15
---

# Plugin Runtime Boundary

Production plugin runtime behavior 由 Rust 拥有。CrawClaw 不会向 plugin entries 注入 TypeScript runtime object，TypeScript plugins 不能注册 tools、hooks、commands、services、providers、channels、HTTP routes 或 Gateway methods。

## Where runtime behavior lives

| Runtime area                                                        | Owner                              |
| ------------------------------------------------------------------- | ---------------------------------- |
| Agent turns and special agents                                      | Rust runtime                       |
| Cron, auto-reply, command execution, and memory jobs                | Rust runtime                       |
| Provider catalog, model list, config schema, and provider transport | Rust provider registry             |
| Tools and workflows                                                 | Rust runtime or Rust native plugin |
| Channels and outbound delivery                                      | Rust channel runtime               |
| Plugin hooks and lifecycle events                                   | Rust event bus                     |

## Plugin package boundary

plugin package 仍然可以包含 package metadata 和 generated artifacts，但这些 code 不是 production execution bridge。production contract 是 manifest 加上 manifest 声明的 Rust native descriptor。

## Adding a runtime capability

1. 在 owning Rust crate 中添加 capability implementation。
2. 通过 Rust native plugin registry 或 typed Gateway RPC 暴露 capability。
3. 在 `crawclaw.plugin.json` 中添加 manifest/config schema metadata。
4. 更新 generated SDK/config baselines 和 docs。

## Related

- [SDK Overview](/plugins/sdk-overview) -- import map 和 SDK boundary
- [Plugin Entry Points](/plugins/sdk-entrypoints) -- current discovery inputs
- [Plugin Internals](/plugins/architecture) -- architecture 和 capability model
