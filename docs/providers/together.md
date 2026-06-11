---
title: "Together AI"
summary: "Together AI setup (auth + model selection)"
read_when:
  - You want to use Together AI with CrawClaw
  - You need the API key env var or CLI auth choice
---

# Together AI

The [Together AI](https://together.ai) provides access to leading open-source models including Llama, DeepSeek, Kimi, and more through a unified API.

- Provider: `together`
- Auth: `TOGETHER_API_KEY`
- API: OpenAI-compatible

## Quick start

1. Set the API key (recommended: store it for the Gateway):

Open **Settings → Models and replies → Add model** in CrawClaw Desktop, choose
Together AI, paste your API key, and save a `together/<model>` profile. Desktop
stores the key as a local file SecretRef after the connection probe succeeds.

2. Set a default model:

```json5
{
  agents: {
    defaults: {
      model: { primary: "together/moonshotai/Kimi-K2.5" },
    },
  },
}
```

## Non-interactive example

For headless hosts, set `TOGETHER_API_KEY` in the Gateway environment or patch
`models.providers.together.apiKey` to an `env`, `file`, or `exec` SecretRef
with `config.patch`.

This will set `together/moonshotai/Kimi-K2.5` as the default model.

## Environment note

If the Gateway runs as a daemon (launchd/systemd), make sure `TOGETHER_API_KEY`
is available to that process (for example, in `~/.crawclaw/.env` or via
`env.shellEnv`).

## Available models

Together AI provides access to many popular open-source models:

- **GLM 4.7 Fp8** - Default model with 200K context window
- **Llama 3.3 70B Instruct Turbo** - Fast, efficient instruction following
- **Llama 4 Scout** - Vision model with image understanding
- **Llama 4 Maverick** - Advanced vision and reasoning
- **DeepSeek V3.1** - Powerful coding and reasoning model
- **DeepSeek R1** - Advanced reasoning model
- **Kimi K2 Instruct** - High-performance model with 262K context window

All models support standard chat completions and are OpenAI API compatible.
