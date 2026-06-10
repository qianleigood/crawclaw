---
summary: "Legacy bundle compatibility notes"
read_when:
  - 你正在迁移较旧的 Codex、Claude 或 Cursor bundle
  - 你需要用 native plugin 替换 legacy bundle compatibility
title: "Plugin Bundles"
x-i18n:
  generated_at: "2026-06-10T11:28:57Z"
  model: codex
  provider: openai
  source_hash: 3886258358d0007947c35ac4735b143041f2d2346d8bc7033c08c1c2ef156de7
  source_path: plugins/bundles.md
  workflow: 15
---

# Plugin Bundles

CrawClaw Desktop 不再通过 TypeScript plugin runtime 映射 Codex、Claude 或 Cursor bundle manifests。新的 plugin work 应使用带 `crawclaw.plugin.json` 和 Rust native descriptor 的 native CrawClaw plugin。

<Info>
  本页面保留为旧安装的 migration guidance。它不描述 active desktop runtime loader。
</Info>

## Migration Path

使用 native plugin path，而不是 compatible bundle：

1. 创建带有 `crawclaw.plugin.json` 的 native plugin root。
2. 将 static metadata 移入 manifest。
3. 将 executable behavior 移入 Rust native descriptor，并在需要时使用 sidecar。
4. 对 tools、services、providers 和 runtime callbacks 使用 Rust plugin SDK contract。

相关文档：

- [Plugin manifest](/plugins/manifest)
- [SDK overview](/plugins/sdk-overview)
- [SDK entry points](/plugins/sdk-entrypoints)
- [Plugin architecture](/plugins/architecture)
