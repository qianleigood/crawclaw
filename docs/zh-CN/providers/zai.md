---
read_when:
  - 你想在 CrawClaw 中使用 Z.AI / GLM 模型
  - 你需要简单的 ZAI_API_KEY 设置
summary: 将 Z.AI（GLM 模型）与 CrawClaw 一起使用
title: Z.AI
x-i18n:
  generated_at: "2026-06-05T14:45:48Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 358a0532160fd347dd870c7d094f7329f87e4f660a959521f82f7fdd772f524b
  source_path: providers/zai.md
  workflow: 15
---

# Z.AI

Z.AI 是 **GLM** 模型的 API 平台。它为 GLM 提供 REST API 并使用 API 密钥进行认证。在 Z.AI 控制台创建你的 API 密钥。CrawClaw 使用 `zai` 提供商和 Z.AI API 密钥。

## Desktop 设置

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

## 配置片段

```json5
{
  env: { ZAI_API_KEY: "sk-..." },
  agents: { defaults: { model: { primary: "zai/glm-5" } } },
}
```

## 注意事项

- GLM 模型可用作 `zai/<model>`（例如：`zai/glm-5`）。
- `tool_stream` 默认启用，用于 Z.AI 工具调用流式传输。将 `agents.defaults.models["zai/<model>"].params.tool_stream` 设置为 `false` 可禁用。
- 有关模型系列概述，请参阅 [/providers/glm](/providers/glm)。
- Z.AI 使用 Bearer 认证与你的 API 密钥。
