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
  source_hash: 479455ae2682eeb7b67638ec1531bf2f96d18a241abccc5669bbab3dab5c62b4
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

使用 CrawClaw Desktop 进行交互式 setup，或调用本地 Gateway API 做自动化。

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

使用 CrawClaw Desktop 进行交互式 setup，或调用本地 Gateway API 做自动化。

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
