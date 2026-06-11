---
read_when:
  - 你想要一个 API 密钥访问多种 LLM
  - 你想通过 OpenRouter 在 CrawClaw 中运行模型
summary: 使用 OpenRouter 的统一 API 在 CrawClaw 中访问多种模型
title: OpenRouter
x-i18n:
  generated_at: "2026-06-05T14:45:07Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 62614814f636c4e418a7d6babb7708c5ad58f71588df86f3b808ed06a4df0124
  source_path: providers/openrouter.md
  workflow: 15
---

# OpenRouter

OpenRouter 提供了一个**统一 API**，通过单一端点和 API 密钥将请求路由到多种模型。它与 OpenAI 兼容，因此大多数 OpenAI SDK 只需切换基础 URL 即可使用。

## Desktop 设置

在 CrawClaw Desktop 中打开 **Settings → Models and replies → Add model**，
选择 OpenRouter，粘贴 OpenRouter API key，并选择
`openrouter/<provider>/<model>` model ref。连接 probe 通过后，Desktop 会把
key 存为本地 file SecretRef。

在 headless hosts 上，将 `OPENROUTER_API_KEY` 设到 Gateway environment，或用
`config.patch` 将 `models.providers.openrouter.apiKey` patch 为 `env`、`file`
或 `exec` SecretRef。

## 配置片段

```json5
{
  env: { OPENROUTER_API_KEY: "sk-or-..." },
  agents: {
    defaults: {
      model: { primary: "openrouter/anthropic/claude-sonnet-4-6" },
    },
  },
}
```

## 注意事项

- 模型引用格式为 `openrouter/<provider>/<model>`。
- 有关更多模型/提供商选项，请参阅 [/concepts/model-providers](/concepts/model-providers)。
- OpenRouter 在幕后使用 Bearer token 和你的 API 密钥。
