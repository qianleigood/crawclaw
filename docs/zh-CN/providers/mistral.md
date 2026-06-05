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
  source_hash: 66afa57748b1a4d19ee9baa33253fbab2c4b516419d0ed2899df521b1a192b1f
  source_path: providers/mistral.md
  workflow: 15
---

# Mistral

CrawClaw 支持 Mistral 用于文本/图像模型路由（`mistral/...`）以及通过 Voxtral 在媒体理解中进行音频转录。

## Desktop 设置

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

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
