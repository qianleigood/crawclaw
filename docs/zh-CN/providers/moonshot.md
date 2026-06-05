---
read_when:
  - 你想要 Moonshot K2（Moonshot Open Platform）与 Kimi Coding 设置
  - 你需要了解独立的端点、密钥和模型引用
  - 你想要任一提供商的复制粘贴配置
summary: 配置 Moonshot K2 与 Kimi Coding（独立提供商 + 密钥）
title: Moonshot AI
x-i18n:
  generated_at: "2026-06-05T14:44:34Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: e7b49fb70b9ad63fb5bffb82854f776e8f92e07bb89bfbb436a52653da91688f
  source_path: providers/moonshot.md
  workflow: 15
---

# Moonshot AI（Kimi）

Moonshot 提供具有 OpenAI 兼容端点的 Kimi API。配置提供商并将默认模型设置为 `moonshot/kimi-k2.5`，或使用 Kimi Coding 的 `kimi-coding/k2p5`。

当前 Kimi K2 模型 ID：

[//]: # "moonshot-kimi-k2-ids:start"

- `kimi-k2.5`
- `kimi-k2-0905-preview`
- `kimi-k2-turbo-preview`
- `kimi-k2-thinking`
- `kimi-k2-thinking-turbo`

[//]: # "moonshot-kimi-k2-ids:end"

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

Kimi Coding：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

注意：Moonshot 和 Kimi Coding 是独立的提供商。密钥不可互换，端点不同，模型引用不同（Moonshot 使用 `moonshot/...`，Kimi Coding 使用 `kimi-coding/...`）。

## 配置片段（Moonshot API）

```json5
{
  env: { MOONSHOT_API_KEY: "sk-..." },
  agents: {
    defaults: {
      model: { primary: "moonshot/kimi-k2.5" },
      models: {
        // moonshot-kimi-k2-aliases:start
        "moonshot/kimi-k2.5": { alias: "Kimi K2.5" },
        "moonshot/kimi-k2-0905-preview": { alias: "Kimi K2" },
        "moonshot/kimi-k2-turbo-preview": { alias: "Kimi K2 Turbo" },
        "moonshot/kimi-k2-thinking": { alias: "Kimi K2 Thinking" },
        "moonshot/kimi-k2-thinking-turbo": { alias: "Kimi K2 Thinking Turbo" },
        // moonshot-kimi-k2-aliases:end
      },
    },
  },
  models: {
    mode: "merge",
    providers: {
      moonshot: {
        baseUrl: "https://api.moonshot.ai/v1",
        apiKey: "${MOONSHOT_API_KEY}",
        api: "openai-completions",
        models: [
          // moonshot-kimi-k2-models:start
          {
            id: "kimi-k2.5",
            name: "Kimi K2.5",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 256000,
            maxTokens: 8192,
          },
          {
            id: "kimi-k2-0905-preview",
            name: "Kimi K2 0905 Preview",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 256000,
            maxTokens: 8192,
          },
          {
            id: "kimi-k2-turbo-preview",
            name: "Kimi K2 Turbo",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 256000,
            maxTokens: 8192,
          },
          {
            id: "kimi-k2-thinking",
            name: "Kimi K2 Thinking",
            reasoning: true,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 256000,
            maxTokens: 8192,
          },
          {
            id: "kimi-k2-thinking-turbo",
            name: "Kimi K2 Thinking Turbo",
            reasoning: true,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 256000,
            maxTokens: 8192,
          },
          // moonshot-kimi-k2-models:end
        ],
      },
    },
  },
}
```

## Kimi Coding

```json5
{
  env: { KIMI_API_KEY: "sk-..." },
  agents: {
    defaults: {
      model: { primary: "kimi-coding/k2p5" },
      models: {
        "kimi-coding/k2p5": { alias: "Kimi K2.5" },
      },
    },
  },
}
```

## 注意事项

- Moonshot 模型引用使用 `moonshot/<modelId>`。Kimi Coding 模型引用使用 `kimi-coding/<modelId>`。
- 需要时在 `models.providers` 中覆盖定价和上下文元数据。
- 如果 Moonshot 发布了不同的模型上下文限制，请相应调整 `contextWindow`。
- 国际端点使用 `https://api.moonshot.ai/v1`，中国端点使用 `https://api.moonshot.cn/v1`。

## 原生思考模式（Moonshot）

Moonshot Kimi 支持二进制原生思考：

- `thinking: { type: "enabled" }`
- `thinking: { type: "disabled" }`

通过 `agents.defaults.models.<provider/model>.params` 为每个模型配置：

```json5
{
  agents: {
    defaults: {
      models: {
        "moonshot/kimi-k2.5": {
          params: {
            thinking: { type: "disabled" },
          },
        },
      },
    },
  },
}
```

CrawClaw 也映射 Moonshot 的运行时 `/think` 级别：

- `/think off` -> `thinking.type=disabled`
- 任何非关闭的思考级别 -> `thinking.type=enabled`

当 Moonshot 思考启用时，`tool_choice` 必须是 `auto` 或 `none`。CrawClaw 将不兼容的 `tool_choice` 值规范化为 `auto` 以保持兼容性。
