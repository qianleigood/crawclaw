---
read_when:
  - 你想在 CrawClaw 中使用 Cloudflare AI Gateway
  - 你需要 account ID、gateway ID 或 API 密钥环境变量
summary: Cloudflare AI Gateway 设置（认证 + 模型选择）
title: Cloudflare AI Gateway
x-i18n:
  generated_at: "2026-06-05T14:43:17Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 968aff65a09e2862b466d3546991fd52c231c48586eccff6b26dac48669207ef
  source_path: providers/cloudflare-ai-gateway.md
  workflow: 15
---

# Cloudflare AI Gateway

Cloudflare AI Gateway 位于提供商 API 之前，让你添加分析、缓存和控制功能。对于 Anthropic，CrawClaw 通过你的 Gateway 端点使用 Anthropic Messages API。

- 提供商：`cloudflare-ai-gateway`
- Base URL：`https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway_id>/anthropic`
- 默认模型：`cloudflare-ai-gateway/claude-sonnet-4-6`
- API 密钥：`CLOUDFLARE_AI_GATEWAY_API_KEY`（通过 Gateway 发送请求的提供商 API 密钥）

对于 Anthropic 模型，请使用你的 Anthropic API 密钥。

## 快速开始

1. 设置提供商 API 密钥和 Gateway 详情：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

2. 设置默认模型：

```json5
{
  agents: {
    defaults: {
      model: { primary: "cloudflare-ai-gateway/claude-sonnet-4-6" },
    },
  },
}
```

## 非交互式示例

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

## 认证 Gateway

如果你在 Cloudflare 中启用了 Gateway 认证，请添加 `cf-aig-authorization` 标头（这与你的提供商 API 密钥是分开的）。

```json5
{
  models: {
    providers: {
      "cloudflare-ai-gateway": {
        headers: {
          "cf-aig-authorization": "Bearer <cloudflare-ai-gateway-token>",
        },
      },
    },
  },
}
```

## 环境注意事项

如果 Gateway 作为守护进程运行（launchd/systemd），请确保 `CLOUDFLARE_AI_GATEWAY_API_KEY` 对该进程可用（例如，在 `~/.crawclaw/.env` 中或通过 `env.shellEnv`）。
