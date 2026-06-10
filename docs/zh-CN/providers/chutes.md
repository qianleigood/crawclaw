---
title: "Chutes"
summary: "使用 API key auth 设置 Chutes"
read_when:
  - 你想在 CrawClaw 中使用 Chutes models
  - 你需要 Chutes API key、model aliases 或 env var setup
x-i18n:
  generated_at: "2026-06-10T11:23:26Z"
  model: codex
  provider: openai
  source_hash: 90ccd2914fe0d51241783437b59270c940513787f93c50ff9ccf8013061e8162
  source_path: providers/chutes.md
  workflow: 15
---

# Chutes

Chutes 通过 OpenAI-compatible endpoint 提供 hosted open-source models。CrawClaw 内置 `chutes` provider plugin，并使用 API key auth。

- Provider: `chutes`
- Base URL: `https://llm.chutes.ai/v1`
- Auth: `CHUTES_API_KEY`
- Default model: `chutes/zai-org/GLM-4.7-TEE`

## Quick start

通过 CrawClaw Desktop 或本地 Gateway API 设置 Chutes API key：

使用 CrawClaw Desktop 进行交互式 setup，或调用本地 Gateway API 做自动化。

Non-interactive setup：

使用 CrawClaw Desktop 进行交互式 setup，或调用本地 Gateway API 做自动化。

如果 onboarding 还没有设置 default model，再设置默认模型：

使用 CrawClaw Desktop 进行交互式 setup，或调用本地 Gateway API 做自动化。

## API key setup

在 Gateway environment 中设置 key：

```bash
export CHUTES_API_KEY="chutes_..."
```

也可以通过 onboarding 存储：

使用 CrawClaw Desktop 进行交互式 setup，或调用本地 Gateway API 做自动化。

如果 Gateway 作为 daemon 运行，确保 key 对该 process 可用，例如通过 `~/.crawclaw/.env` 或 `env.shellEnv`。

## Model aliases

bundled plugin 会注册 live Chutes catalog 和这些 convenience aliases：

- `chutes-fast` -> `chutes/zai-org/GLM-4.7-FP8`
- `chutes-pro` -> `chutes/deepseek-ai/DeepSeek-V3.2-TEE`
- `chutes-vision` -> `chutes/chutesai/Mistral-Small-3.2-24B-Instruct-2506`

你也可以直接使用任何 catalog model，格式为 `chutes/<model-id>`。

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

使用 CrawClaw Desktop 进行交互式 setup，或调用本地 Gateway API 做自动化。

## Troubleshooting

- `missing auth` 或 `unauthorized`：重新运行 CrawClaw Desktop 或本地 Gateway API，或设置 `CHUTES_API_KEY`。
- Daemon 看不到 key：把 `CHUTES_API_KEY` 放到 Gateway environment 中，而不是只放在 interactive shell 里。
