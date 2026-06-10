---
summary: "在 CrawClaw 中使用 xAI Grok models"
read_when:
  - 你想在 CrawClaw 中使用 Grok models
  - 你正在配置 xAI auth 或 model ids
title: "xAI"
x-i18n:
  generated_at: "2026-06-10T11:23:26Z"
  model: codex
  provider: openai
  source_hash: 12d3efbaa068b4fa24d2f28db9d4d759ab3aabce521f1140457cc1a9f4292bce
  source_path: providers/xai.md
  workflow: 15
---

# xAI

CrawClaw 内置 `xai` provider plugin，用于 Grok models。

## Setup

1. 在 xAI console 中创建 API key。
2. 设置 `XAI_API_KEY`，或运行：

使用 CrawClaw Desktop 进行交互式 setup，或调用本地 Gateway API 做自动化。

3. 选择一个 model，例如：

```json5
{
  agents: { defaults: { model: { primary: "xai/grok-4" } } },
}
```

CrawClaw 现在使用 xAI Responses API 作为 bundled xAI transport。

## Current bundled model catalog

CrawClaw 现在内置这些 xAI model families：

- `grok-4`, `grok-4-0709`
- `grok-4-fast-reasoning`, `grok-4-fast-non-reasoning`
- `grok-4-1-fast-reasoning`, `grok-4-1-fast-non-reasoning`
- `grok-4.20-reasoning`, `grok-4.20-non-reasoning`
- `grok-code-fast-1`

当 newer `grok-4*` 和 `grok-code-fast*` ids 遵循相同 API shape 时，plugin 也会 forward-resolve。

## Known limits

- Auth 目前仅支持 API-key。CrawClaw 还没有 xAI OAuth/device-code flow。
- `grok-4.20-multi-agent-experimental-beta-0304` 不支持普通 xAI provider path，因为它要求的 upstream API surface 不同于 standard CrawClaw xAI transport。

## Notes

- CrawClaw 会在 shared runner path 上自动应用 xAI-specific tool-schema 和 tool-call compatibility fixes。
- xAI 只是 model provider。CrawClaw 不再把 xAI-owned web search 或 remote code-execution add-ons 作为 agent tools 暴露。
- 更完整的 provider overview 参见 [Model providers](/providers/index)。
