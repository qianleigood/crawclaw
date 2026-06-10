---
title: "Context Engine Removal"
summary: "已移除 legacy context-engine plugin surface 的迁移说明"
read_when:
  - 你在迁移旧 context-engine plugin
  - 你在检查当前 context assembly 和 compaction 边界
x-i18n:
  generated_at: "2026-06-10T10:43:13Z"
  model: codex
  provider: openai
  source_hash: 111becfd5e343c6e3ae7dd9aea55aea62882a7f0441c0157fef7c47738676026
  source_path: concepts/context-engine.md
  workflow: 15
---

# Context Engine Removal

legacy `context-engine` plugin surface 已从 CrawClaw 中移除。

当前状态：

- Context assembly 和 compaction 通过内置 memory runtime 运行。
- Plugin manifests 仍可为独占 memory slot 使用 `kind: "memory"`。
- `api.registerContextEngine(...)`、`plugins.slots.contextEngine` 和旧 compaction delegation bridge 不再受支持。

如果你在迁移旧 plugin，请把自定义 context behavior 移到 Rust memory runtime 上，而不是尝试重建旧 engine registry。
