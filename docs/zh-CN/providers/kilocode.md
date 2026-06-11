---
read_when:
  - 你想要一个 API 密钥访问多种 LLM
  - 你想通过 Kilo Gateway 在 CrawClaw 中运行模型
summary: 使用 Kilo Gateway 的统一 API 在 CrawClaw 中访问多种模型
title: Kilo Gateway
x-i18n:
  generated_at: "2026-06-05T14:43:42Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 1f1371c9f82f612590a5cf707ccdc9cf3c50d61f7b68e1c5435f5fbfbec86650
  source_path: providers/kilocode.md
  workflow: 15
---

# Kilo Gateway

Kilo Gateway 提供了一个**统一 API**，通过单一端点和 API 密钥将请求路由到多种模型。它与 OpenAI 兼容，因此大多数 OpenAI SDK 只需切换基础 URL 即可使用。

## 获取 API 密钥

1. 前往 [app.kilo.ai](https://app.kilo.ai)
2. 登录或创建账户
3. 导航到 API Keys 并生成新密钥

## Desktop 设置

在 CrawClaw Desktop 中打开 **Settings → Models and replies → Add model**，
选择 Kilo Code，粘贴 Kilo Gateway API key，并保存 `kilocode/<model>` profile。
连接 probe 通过后，Desktop 会把 key 存为本地 file SecretRef。

在 headless hosts 上，将 `KILOCODE_API_KEY` 设到 Gateway environment，或用
`config.patch` 将 `models.providers.kilocode.apiKey` patch 为 `env`、`file` 或
`exec` SecretRef。

或设置环境变量：

```bash
export KILOCODE_API_KEY="<your-kilocode-api-key>" # pragma: allowlist secret
```

## 配置片段

```json5
{
  env: { KILOCODE_API_KEY: "<your-kilocode-api-key>" }, // pragma: allowlist secret
  agents: {
    defaults: {
      model: { primary: "kilocode/kilo/auto" },
    },
  },
}
```

## 默认模型

默认模型是 `kilocode/kilo/auto`，这是一个智能路由模型，能够根据任务自动选择最佳底层模型：

- 规划、调试和编排任务路由到 Claude Opus
- 代码编写和探索任务路由到 Claude Sonnet

## 可用模型

CrawClaw 在启动时从 Kilo Gateway 动态发现可用模型。使用 `/models kilocode` 查看你账户可用的完整模型列表。

任何在 gateway 上可用的模型都可以使用 `kilocode/` 前缀：

```
kilocode/kilo/auto              （默认 - 智能路由）
kilocode/anthropic/claude-sonnet-4
kilocode/openai/gpt-5.2
kilocode/google/gemini-3-pro-preview
...以及更多
```

## 注意事项

- 模型引用格式为 `kilocode/<model-id>`（例如 `kilocode/anthropic/claude-sonnet-4`）。
- 默认模型：`kilocode/kilo/auto`
- 基础 URL：`https://api.kilo.ai/api/gateway/`
- 有关更多模型/提供商选项，请参阅 [/concepts/model-providers](/concepts/model-providers)。
- Kilo Gateway 在幕后使用 Bearer token 和你的 API 密钥。
