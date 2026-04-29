---
title: "Chutes"
summary: "Chutes setup with OAuth or API key auth"
read_when:
  - You want to use Chutes models with CrawClaw
  - You need Chutes OAuth, API key, model aliases, or env var setup
---

# Chutes

Chutes provides hosted open-source models through an OpenAI-compatible endpoint.
CrawClaw ships a bundled `chutes` provider plugin with OAuth and API key auth.

- Provider: `chutes`
- Base URL: `https://llm.chutes.ai/v1`
- Auth: Chutes OAuth, `CHUTES_API_KEY`, or `CHUTES_OAUTH_TOKEN`
- Default model: `chutes/zai-org/GLM-4.7-TEE`

## Quick start

Use OAuth when you want browser sign-in:

```bash
crawclaw onboard --auth-choice chutes
```

Use an API key when you want a simple headless setup:

```bash
crawclaw onboard --auth-choice chutes-api-key
```

For non-interactive setup:

```bash
crawclaw onboard --non-interactive \
  --auth-choice chutes-api-key \
  --chutes-api-key "$CHUTES_API_KEY"
```

Then set a default model if onboarding did not already do it:

```bash
crawclaw models set chutes/zai-org/GLM-4.7-TEE
```

## API key setup

Set the key in the Gateway environment:

```bash
export CHUTES_API_KEY="chutes_..."
```

Or store it with onboarding:

```bash
crawclaw onboard --auth-choice chutes-api-key
```

If the Gateway runs as a daemon, make sure the key is available to that process,
for example through `~/.crawclaw/.env` or `env.shellEnv`.

## OAuth setup

The OAuth flow uses browser sign-in and stores a Chutes auth profile. For remote
or VPS environments, CrawClaw prints a URL for your local browser and asks you to
paste the callback URL.

Advanced OAuth app settings:

- `CHUTES_CLIENT_ID`: OAuth client id. If unset, CrawClaw prompts for it.
- `CHUTES_CLIENT_SECRET`: optional OAuth client secret.
- `CHUTES_OAUTH_REDIRECT_URI`: redirect URI. Defaults to `http://127.0.0.1:1456/oauth-callback`.
- `CHUTES_OAUTH_SCOPES`: scopes. Defaults to `openid profile chutes:invoke`.

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

```bash
crawclaw models status
crawclaw models list | grep chutes
crawclaw agent --model chutes/zai-org/GLM-4.7-TEE --message "Hello"
```

## Troubleshooting

- `missing auth` or `unauthorized`: rerun `crawclaw onboard --auth-choice chutes` or set `CHUTES_API_KEY`.
- OAuth callback does not complete: verify the OAuth app redirect URI matches
  `CHUTES_OAUTH_REDIRECT_URI`.
- Daemon cannot see the key: put `CHUTES_API_KEY` in the Gateway environment,
  not only in your interactive shell.
