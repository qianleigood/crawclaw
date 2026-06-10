---
summary: "通过 vLLM 运行 CrawClaw（OpenAI-compatible local server）"
read_when:
  - 你想让 CrawClaw 连接本地 vLLM server
  - 你想用自己的 models 暴露 OpenAI-compatible /v1 endpoints
title: "vLLM"
x-i18n:
  generated_at: "2026-06-10T11:23:26Z"
  model: codex
  provider: openai
  source_hash: 9095a13377a41d7a6df423a018601f4d09ee334491256e0ac400639cb3928f27
  source_path: providers/vllm.md
  workflow: 15
---

# vLLM

vLLM 可以通过 **OpenAI-compatible** HTTP API 服务 open-source（和部分 custom）models。CrawClaw 可以使用 `openai-completions` API 连接 vLLM。

当你通过 `VLLM_API_KEY` opt in（如果 server 不强制 auth，任意值都可以），且没有定义显式 `models.providers.vllm` entry 时，CrawClaw 也可以从 vLLM **auto-discover** 可用 models。

## Quick start

1. 使用 OpenAI-compatible server 启动 vLLM。

你的 base URL 应暴露 `/v1` endpoints（例如 `/v1/models`、`/v1/chat/completions`）。vLLM 通常运行在：

- `http://127.0.0.1:8000/v1`

2. Opt in（如果没有配置 auth，任意值都可以）：

```bash
export VLLM_API_KEY="vllm-local"
```

3. 选择一个 model（替换为你的 vLLM model IDs 之一）：

```json5
{
  agents: {
    defaults: {
      model: { primary: "vllm/your-model-id" },
    },
  },
}
```

## Explicit configuration

在以下情况使用 explicit config：

- vLLM 运行在不同 host/port。
- 你想固定 `contextWindow` / `maxTokens` values。
- 你的 server 需要真实 API key，或你想控制 headers。

CrawClaw 只会写入你配置的 provider models。要检查本地 vLLM model IDs，查询 server 的 OpenAI-compatible models endpoint，例如 `GET http://127.0.0.1:8000/v1/models`。

```json5
{
  models: {
    providers: {
      vllm: {
        baseUrl: "http://127.0.0.1:8000/v1",
        apiKey: "${VLLM_API_KEY}",
        api: "openai-completions",
        models: [
          {
            id: "your-model-id",
            name: "Local vLLM Model",
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

## Troubleshooting

- 检查 server 是否可访问：

```bash
curl http://127.0.0.1:8000/v1/models
```

- 如果 requests 因 auth errors 失败，设置一个与 server configuration 匹配的真实 `VLLM_API_KEY`，或在 `models.providers.vllm` 下显式配置 provider。
