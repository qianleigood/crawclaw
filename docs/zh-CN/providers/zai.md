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
  source_hash: edd66c5ecfeb1a23b70ecf7689166dba1cd2532433318fbcedf35347dca4c996
  source_path: providers/zai.md
  workflow: 15
---

# Z.AI

Z.AI 是 **GLM** 模型的 API 平台。它为 GLM 提供 REST API 并使用 API 密钥进行认证。在 Z.AI 控制台创建你的 API 密钥。CrawClaw 使用 `zai` 提供商和 Z.AI API 密钥。

## Desktop 设置

在 CrawClaw Desktop 中打开 **Settings → Models and replies → Add model**，
选择 Z.AI，粘贴 Z.AI API key，并保存 `zai/<model>` profile。连接 probe 通过后，
Desktop 会把 key 存为本地 file SecretRef。

在 headless hosts 上，将 `ZAI_API_KEY` 设到 Gateway environment，或用
`config.patch` 将 `models.providers.zai.apiKey` patch 为 `env`、`file` 或
`exec` SecretRef。

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
