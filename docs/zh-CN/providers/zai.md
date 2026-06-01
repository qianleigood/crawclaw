---
read_when:
  - 你想在 CrawClaw 中使用 Z.AI / GLM 模型
  - 你需要简单的 `ZAI_API_KEY` 设置
summary: 在 CrawClaw 中使用 Z.AI（GLM 模型）
title: Z.AI
x-i18n:
  generated_at: "2026-03-16T06:27:34Z"
  model: gpt-5.4
  provider: openai
  source_hash: 79ea8f3d6c286b5fef090e54257eb7c60c82b29630cee3f54e96161e55349bf5
  source_path: providers/zai.md
  workflow: 15
---

# Z.AI

Z.AI 是 **GLM** 模型的 API 平台。它为 GLM 提供 REST API，并使用 API key
进行认证。请在 Z.AI 控制台中创建你的 API key。CrawClaw 使用 `zai` 提供商
配合 Z.AI API key。

## CLI 设置

使用 CrawClaw Desktop 进行交互式设置；自动化场景调用本地 Gateway API。

## 配置片段

```json5
{
  env: { ZAI_API_KEY: "sk-..." },
  agents: { defaults: { model: { primary: "zai/glm-5" } } },
}
```

## 说明

- GLM 模型可用作 `zai/<model>`（例如：`zai/glm-5`）。
- `tool_stream` 默认启用，用于 Z.AI 工具调用流式传输。若要禁用，请设置
  `agents.defaults.models["zai/<model>"].params.tool_stream` 为 `false`。
- 关于模型家族概览，请参阅 [/providers/glm](/providers/glm)。
- Z.AI 使用带有你的 API key 的 Bearer 认证。
