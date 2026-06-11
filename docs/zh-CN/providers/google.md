---
title: "Google (Gemini)"
summary: "Google Gemini 设置（API key + OAuth、image generation、media understanding、web search）"
read_when:
  - 你想在 CrawClaw 中使用 Google Gemini models
  - 你需要 API key 或 OAuth auth flow
x-i18n:
  generated_at: "2026-06-10T11:23:26Z"
  model: codex
  provider: openai
  source_hash: 704a45f5fcf0f626616bee3be29dcc33e2fcf5dbf0fd879a1d5d8f814748c791
  source_path: providers/google.md
  workflow: 15
---

# Google (Gemini)

Google plugin 通过 Google AI Studio 提供 Gemini models，并通过 Gemini Grounding 提供 image generation、media understanding（image/audio/video）和 web search。

- Provider: `google`
- Auth: `GEMINI_API_KEY` 或 `GOOGLE_API_KEY`
- API: Google Gemini API

## Quick start

1. 设置 API key：

在 CrawClaw Desktop 中打开 **Settings → Models and replies → Add model**，
选择 Google，粘贴 Google AI Studio API key，并保存 `google/<model>` profile。
连接 probe 通过后，Desktop 会把 key 存为本地 file SecretRef。

2. 设置 default model：

```json5
{
  agents: {
    defaults: {
      model: { primary: "google/gemini-3.1-pro-preview" },
    },
  },
}
```

## Non-interactive example

在 headless hosts 上，将 `GEMINI_API_KEY` 或 `GOOGLE_API_KEY` 设到 Gateway
environment，或用 `config.patch` 将 `models.providers.google.apiKey` patch 为
`env`、`file` 或 `exec` SecretRef。将 `agents.defaults.model.primary` 设为
`google/<model>` ref。

## Capabilities

| Capability             | Supported         |
| ---------------------- | ----------------- |
| Chat completions       | Yes               |
| Image generation       | Yes               |
| Image understanding    | Yes               |
| Audio transcription    | Yes               |
| Video understanding    | Yes               |
| Web search (Grounding) | Yes               |
| Thinking/reasoning     | Yes (Gemini 3.1+) |

## Environment note

如果 Gateway 作为 daemon（launchd/systemd）运行，确保 `GEMINI_API_KEY` 对该 process 可用，例如放在 `~/.crawclaw/.env` 或通过 `env.shellEnv`。
