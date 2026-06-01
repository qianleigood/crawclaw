---
title: "Chutes"
summary: "Chutes setup with API key auth"
read_when:
  - You want to use Chutes models with CrawClaw
  - You need Chutes API key, model aliases, or env var setup
---

# Chutes

Chutes provides hosted open-source models through an OpenAI-compatible endpoint.
CrawClaw ships a bundled `chutes` provider plugin with API key auth.

- Provider: `chutes`
- Base URL: `https://llm.chutes.ai/v1`
- Auth: `CHUTES_API_KEY`
- Default model: `chutes/zai-org/GLM-4.7-TEE`

## Quick start

Set a Chutes API key through CrawClaw Desktop or the local Gateway API:

Use CrawClaw Desktop for interactive setup, or call the local Gateway API for automation.

For non-interactive setup:

Use CrawClaw Desktop for interactive setup, or call the local Gateway API for automation.

Then set a default model if onboarding did not already do it:

Use CrawClaw Desktop for interactive setup, or call the local Gateway API for automation.

## API key setup

Set the key in the Gateway environment:

```bash
export CHUTES_API_KEY="chutes_..."
```

Or store it with onboarding:

Use CrawClaw Desktop for interactive setup, or call the local Gateway API for automation.

If the Gateway runs as a daemon, make sure the key is available to that process,
for example through `~/.crawclaw/.env` or `env.shellEnv`.

## Model aliases

The bundled plugin registers the live Chutes catalog and these convenience aliases:

- `chutes-fast` -> `chutes/zai-org/GLM-4.7-FP8`
- `chutes-pro` -> `chutes/deepseek-ai/DeepSeek-V3.2-TEE`
- `chutes-vision` -> `chutes/chutesai/Mistral-Small-3.2-24B-Instruct-2506`

You can also use any catalog model directly as `chutes/<model-id>`.

## Config example

```json5
{
  env: { CHUTES_API_KEY: "chutes_..." },
  agents: {
    defaults: {
      model: {
        primary: "chutes/zai-org/GLM-4.7-TEE",
        fallbacks: ["chutes/deepseek-ai/DeepSeek-V3.2-TEE", "chutes/Qwen/Qwen3-32B"],
      },
      imageModel: {
        primary: "chutes/chutesai/Mistral-Small-3.2-24B-Instruct-2506",
        fallbacks: ["chutes/chutesai/Mistral-Small-3.1-24B-Instruct-2503"],
      },
    },
  },
}
```

## Verify

Use CrawClaw Desktop for interactive setup, or call the local Gateway API for automation.

## Troubleshooting

- `missing auth` or `unauthorized`: rerun CrawClaw Desktop or the local Gateway API or set `CHUTES_API_KEY`.
- Daemon cannot see the key: put `CHUTES_API_KEY` in the Gateway environment,
  not only in your interactive shell.
