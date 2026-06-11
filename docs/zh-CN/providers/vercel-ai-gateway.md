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
  source_hash: 8ea5ce60ce0b3cfaeaac15d8ded3b42ca19db84520b51f58afb8fa378aa4488c
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

在 CrawClaw Desktop 中打开 **Settings → Models and replies → Add model**，
选择 Vercel AI Gateway，粘贴 `AI_GATEWAY_API_KEY`，并保存
`vercel-ai-gateway/<provider>/<model>` profile。连接 probe 通过后，Desktop 会把 key
存为本地 file SecretRef。

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

在 headless hosts 上，将 `AI_GATEWAY_API_KEY` 设到 Gateway environment，或用
`config.patch` 将 `models.providers.vercel-ai-gateway.apiKey` patch 为 `env`、
`file` 或 `exec` SecretRef。

## 环境注意事项

如果 Gateway 作为守护进程运行（launchd/systemd），请确保 `AI_GATEWAY_API_KEY` 对该进程可用（例如，在 `~/.crawclaw/.env` 中或通过 `env.shellEnv`）。

## 模型 ID 简写

CrawClaw 接受 Vercel Claude 简写模型引用并在运行时规范化：

- `vercel-ai-gateway/claude-opus-4.6` -> `vercel-ai-gateway/anthropic/claude-opus-4.6`
- `vercel-ai-gateway/opus-4.6` -> `vercel-ai-gateway/anthropic/claude-opus-4-6`
