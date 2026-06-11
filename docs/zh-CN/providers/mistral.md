---
read_when:
  - 你想在 CrawClaw 中使用 Mistral 模型
  - 你需要 Mistral API key 新手引导和模型引用
summary: 在 CrawClaw 中使用 Mistral 模型和 Voxtral 转录
title: Mistral
x-i18n:
  generated_at: "2026-06-05T14:44:16Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: c326e7ce2ee5e8f7cbe3352224c046e8ef53a66bce419649f5d1429c516d2b0d
  source_path: providers/mistral.md
  workflow: 15
---

# Mistral

CrawClaw 支持 Mistral 用于文本/图像模型路由（`mistral/...`）以及通过 Voxtral 在媒体理解中进行音频转录。

## Desktop 设置

在 CrawClaw Desktop 中打开 **Settings → Models and replies → Add model**，
选择 Mistral，粘贴 Mistral API key，并保存 `mistral/<model>` profile。连接
probe 通过后，Desktop 会把 key 存为本地 file SecretRef。

在 headless hosts 上，将 `MISTRAL_API_KEY` 设到 Gateway environment，或用
`config.patch` 将 `models.providers.mistral.apiKey` patch 为 `env`、`file` 或
`exec` SecretRef。

## 配置片段（LLM 提供商）

```json5
{
  env: { MISTRAL_API_KEY: "sk-..." },
  agents: { defaults: { model: { primary: "mistral/mistral-large-latest" } } },
}
```

## 配置片段（使用 Voxtral 进行音频转录）

```json5
{
  tools: {
    media: {
      audio: {
        enabled: true,
        models: [{ provider: "mistral", model: "voxtral-mini-latest" }],
      },
    },
  },
}
```

## 注意事项

- Mistral 认证使用 `MISTRAL_API_KEY`。
- 提供商 base URL 默认为 `https://api.mistral.ai/v1`。
- 新手引导默认模型为 `mistral/mistral-large-latest`。
- Mistral 的媒体理解默认音频模型为 `voxtral-mini-latest`。
- 媒体转录路径使用 `/v1/audio/transcriptions`。
