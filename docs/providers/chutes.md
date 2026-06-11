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

Open **CrawClaw Desktop → Settings → Models and replies → Add model**, choose
**Chutes**, paste the API key, and select a default model.

For non-interactive setup:

Expose `CHUTES_API_KEY` to the Gateway process. For headless config writes, call
`config.patch` with the Chutes provider and default model:

```json5
{
  method: "config.patch",
  params: {
    baseHash: "<hash from config.get>",
    raw: '{ agents: { defaults: { model: { primary: "chutes/zai-org/GLM-4.7-TEE" } } }, models: { mode: "merge", providers: { chutes: { baseUrl: "https://llm.chutes.ai/v1", apiKey: "${CHUTES_API_KEY}", api: "openai-completions" } } } }',
  },
}
```

Then set a default model if onboarding did not already do it:

Use the Desktop model picker, or patch `agents.defaults.model.primary` to a
`chutes/...` model ref.

## API key setup

Set the key in the Gateway environment:

```bash
export CHUTES_API_KEY="chutes_..."
```

Or store it with onboarding:

Use the Desktop **Add model** flow to save the key as a local runtime secret.
For headless hosts, prefer an environment variable, file SecretRef, or
`config.patch` metadata that points at a SecretRef.

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

Use CrawClaw Desktop's model status surface or `/model status` in chat. For
automation, call `models.list` to confirm Chutes models are visible and
`usage.status` to confirm the provider is configured.

## Troubleshooting

- `missing auth` or `unauthorized`: rerun CrawClaw Desktop or the local Gateway API or set `CHUTES_API_KEY`.
- Daemon cannot see the key: put `CHUTES_API_KEY` in the Gateway environment,
  not only in your interactive shell.
