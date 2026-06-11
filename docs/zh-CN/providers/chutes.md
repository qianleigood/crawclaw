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
  source_hash: 0c5f600494c1bd902c1ee748368970772f15d0d7c4cea3ad9df402867fd94c0b
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

打开 **CrawClaw Desktop → Settings → Models and replies → Add model**，选择
**Chutes**，粘贴 API key，并选择默认模型。

Non-interactive setup：

将 `CHUTES_API_KEY` 暴露给 Gateway 进程。对于 headless config 写入，调用
`config.patch` 设置 Chutes provider 和默认模型：

```json5
{
  method: "config.patch",
  params: {
    baseHash: "<hash from config.get>",
    raw: '{ agents: { defaults: { model: { primary: "chutes/zai-org/GLM-4.7-TEE" } } }, models: { mode: "merge", providers: { chutes: { baseUrl: "https://llm.chutes.ai/v1", apiKey: "${CHUTES_API_KEY}", api: "openai-completions" } } } }',
  },
}
```

如果 onboarding 还没有设置 default model，再设置默认模型：

使用 Desktop 模型选择器，或将 `agents.defaults.model.primary` patch 到一个
`chutes/...` model ref。

## API key setup

在 Gateway environment 中设置 key：

```bash
export CHUTES_API_KEY="chutes_..."
```

也可以通过 onboarding 存储：

使用 Desktop **Add model** flow 将 key 保存为本地 runtime secret。对于 headless
hosts，优先使用环境变量、file SecretRef，或指向 SecretRef 的 `config.patch`
metadata。

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

使用 CrawClaw Desktop 的模型状态界面，或在 chat 中使用 `/model status`。自动化场景下，调用 `models.list` 确认 Chutes models 可见，并调用 `usage.status` 确认 provider 已配置。

## Troubleshooting

- `missing auth` 或 `unauthorized`：重新运行 CrawClaw Desktop 或本地 Gateway API，或设置 `CHUTES_API_KEY`。
- Daemon 看不到 key：把 `CHUTES_API_KEY` 放到 Gateway environment 中，而不是只放在 interactive shell 里。
