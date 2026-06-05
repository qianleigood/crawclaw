---
read_when:
  - 你想针对本地 SGLang 服务器运行 CrawClaw
  - 你想使用自己的模型通过 OpenAI 兼容 /v1 端点
summary: 使用 SGLang（OpenAI 兼容的自托管服务器）运行 CrawClaw
title: SGLang
x-i18n:
  generated_at: "2026-06-05T14:45:25Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: f06b48226dc03b3bcefaada98b5f13ab50876f34e795c65a9aca8c7d2f3b35bc
  source_path: providers/sglang.md
  workflow: 15
---

# SGLang

SGLang 可以通过 **OpenAI 兼容** HTTP API 提供开源模型服务。
CrawClaw 可以使用 `openai-completions` API 连接到 SGLang。

当你通过 `SGLANG_API_KEY` 选择加入（如果服务器不强制认证，任何值都可以）且未定义显式 `models.providers.sglang` 条目时，CrawClaw 也可以**自动发现** SGLang 中可用的模型。

## 快速开始

1. 使用 OpenAI 兼容服务器启动 SGLang。

你的 base URL 应暴露 `/v1` 端点（例如 `/v1/models`、`/v1/chat/completions`）。SGLang 通常运行在：

- `http://127.0.0.1:30000/v1`

2. 选择加入（如果未配置认证，任何值都可以）：

```bash
export SGLANG_API_KEY="sglang-local"
```

3. 运行新手引导并选择 `SGLang`，或直接设置模型：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

```json5
{
  agents: {
    defaults: {
      model: { primary: "sglang/your-model-id" },
    },
  },
}
```

## 显式配置

在以下情况下使用显式配置：

- SGLang 在不同主机/端口上运行。
- 你想固定 `contextWindow`/`maxTokens` 值。
- 你的服务器需要真实 API key（或你想控制 headers）。

CrawClaw 仅写入你配置的提供商模型。要检查本地 SGLang 模型 ID，请查询服务器的 OpenAI 兼容模型端点，例如 `GET http://127.0.0.1:30000/v1/models`。

```json5
{
  models: {
    providers: {
      sglang: {
        baseUrl: "http://127.0.0.1:30000/v1",
        apiKey: "${SGLANG_API_KEY}",
        api: "openai-completions",
        models: [
          {
            id: "your-model-id",
            name: "Local SGLang Model",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 8192,
          },
        ],
      },
    },
  },
}
```

## 故障排除

- 检查服务器是否可达：

```bash
curl http://127.0.0.1:30000/v1/models
```

- 如果请求因认证错误失败，请设置与服务器配置匹配的真实 `SGLANG_API_KEY`，或在 `models.providers.sglang` 下显式配置提供商。
