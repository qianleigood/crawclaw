---
title: "Google (Gemini)"
summary: "Google Gemini setup (API key + OAuth, image generation, media understanding, web search)"
read_when:
  - You want to use Google Gemini models with CrawClaw
  - You need the API key or OAuth auth flow
---

# Google (Gemini)

The Google plugin provides access to Gemini models through Google AI Studio, plus
image generation, media understanding (image/audio/video), and web search via
Gemini Grounding.

- Provider: `google`
- Auth: `GEMINI_API_KEY` or `GOOGLE_API_KEY`
- API: Google Gemini API

## Quick start

1. Set the API key:

Open **Settings → Models and replies → Add model** in CrawClaw Desktop, choose
Google, paste a Google AI Studio API key, and save a `google/<model>` profile.
Desktop stores the key as a local file SecretRef after the connection probe
succeeds.

2. Set a default model:

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

For headless hosts, set `GEMINI_API_KEY` or `GOOGLE_API_KEY` in the Gateway
environment, or patch `models.providers.google.apiKey` to an `env`, `file`, or
`exec` SecretRef with `config.patch`. Set `agents.defaults.model.primary` to a
`google/<model>` ref.

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

If the Gateway runs as a daemon (launchd/systemd), make sure `GEMINI_API_KEY`
is available to that process (for example, in `~/.crawclaw/.env` or via
`env.shellEnv`).
