---
read_when:
  - 你想在 CrawClaw 中使用 Vercel AI Gateway
  - 你需要 API 密钥环境变量或 CLI 认证选项
summary: Vercel AI Gateway 设置（认证 + 模型选择）
title: Vercel AI Gateway
x-i18n:
  generated_at: "2026-06-05T14:45:40Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 8efbccc025b5c651a3eb514a3980443de61d838cfcfe22253fac266cb163c53d
  source_path: providers/vercel-ai-gateway.md
  workflow: 15
---

# Vercel AI Gateway

[Vercel AI Gateway](https://vercel.com/ai-gateway) 提供统一 API，通过单一端点访问数百种模型。

- 提供商：`vercel-ai-gateway`
- 认证：`AI_GATEWAY_API_KEY`
- API：Anthropic Messages 兼容
- CrawClaw 自动发现 Gateway `/v1/models` 目录，因此 `/models vercel-ai-gateway` 包含当前模型引用，如 `vercel-ai-gateway/openai/gpt-5.4`。

## 快速开始

1. 设置 API 密钥（推荐：将其存储到 Gateway）：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

2. 设置默认模型：

```json5
{
  agents: {
    defaults: {
      model: { primary: "vercel-ai-gateway/anthropic/claude-opus-4.6" },
    },
  },
}
```

## 非交互式示例

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

## 环境注意事项

如果 Gateway 作为守护进程运行（launchd/systemd），请确保 `AI_GATEWAY_API_KEY` 对该进程可用（例如，在 `~/.crawclaw/.env` 中或通过 `env.shellEnv`）。

## 模型 ID 简写

CrawClaw 接受 Vercel Claude 简写模型引用并在运行时规范化：

- `vercel-ai-gateway/claude-opus-4.6` -> `vercel-ai-gateway/anthropic/claude-opus-4.6`
- `vercel-ai-gateway/opus-4.6` -> `vercel-ai-gateway/anthropic/claude-opus-4-6`
