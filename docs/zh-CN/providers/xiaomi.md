---
read_when:
  - 你想在 CrawClaw 中使用小米 MiMo 模型
  - 你需要 XIAOMI_API_KEY 设置
summary: 在 CrawClaw 中使用小米 MiMo 模型
title: Xiaomi MiMo
x-i18n:
  generated_at: "2026-06-05T14:45:48Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: fff8a2ef06efb16c5a960da10176a9442bbfdb862916eefad7973abea0a46b8b
  source_path: providers/xiaomi.md
  workflow: 15
---

# Xiaomi MiMo

Xiaomi MiMo 是 **MiMo** 模型的 API 平台。CrawClaw 使用小米 OpenAI 兼容端点进行 API 密钥认证。在
[Xiaomi MiMo 控制台](https://platform.xiaomimimo.com/#/console/api-keys) 中创建你的 API 密钥，然后使用该密钥配置捆绑的 `xiaomi` 提供商。

## 模型概览

- **mimo-v2-flash**：默认文本模型，262144 token 上下文窗口
- **mimo-v2-pro**：推理文本模型，1048576 token 上下文窗口
- **mimo-v2-omni**：支持文本和图像输入的推理多模态模型，262144 token 上下文窗口
- 基础 URL：`https://api.xiaomimimo.com/v1`
- API：`openai-completions`
- 授权：`Bearer $XIAOMI_API_KEY`

## Desktop 设置

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 实现自动化。

## 配置片段

```json5
{
  env: { XIAOMI_API_KEY: "your-key" },
  agents: { defaults: { model: { primary: "xiaomi/mimo-v2-flash" } } },
  models: {
    mode: "merge",
    providers: {
      xiaomi: {
        baseUrl: "https://api.xiaomimimo.com/v1",
        api: "openai-completions",
        apiKey: "XIAOMI_API_KEY",
        models: [
          {
            id: "mimo-v2-flash",
            name: "Xiaomi MiMo V2 Flash",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 262144,
            maxTokens: 8192,
          },
          {
            id: "mimo-v2-pro",
            name: "Xiaomi MiMo V2 Pro",
            reasoning: true,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 1048576,
            maxTokens: 32000,
          },
          {
            id: "mimo-v2-omni",
            name: "Xiaomi MiMo V2 Omni",
            reasoning: true,
            input: ["text", "image"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 262144,
            maxTokens: 32000,
          },
        ],
      },
    },
  },
}
```

## 注意事项

- 默认模型引用：`xiaomi/mimo-v2-flash`。
- 其他内置模型：`xiaomi/mimo-v2-pro`、`xiaomi/mimo-v2-omni`。
- 当设置 `XIAOMI_API_KEY`（或存在认证配置）时，提供商会自动注入。
- 有关提供商规则，请参阅 [/concepts/model-providers](/concepts/model-providers)。
