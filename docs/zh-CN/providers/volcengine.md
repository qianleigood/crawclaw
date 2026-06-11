---
title: "Volcengine (Doubao)"
summary: "Volcano Engine 设置（Doubao models，general + coding endpoints）"
read_when:
  - 你想在 CrawClaw 中使用 Volcano Engine 或 Doubao models
  - 你需要 Volcengine API key setup
x-i18n:
  generated_at: "2026-06-10T11:23:26Z"
  model: codex
  provider: openai
  source_hash: e47e894a3eead794ca7a02c4121d77747b9c6fe29893be952f37b07f46624347
  source_path: providers/volcengine.md
  workflow: 15
---

# Volcengine (Doubao)

Volcengine provider 提供对 Doubao models 和 Volcano Engine 上托管的 third-party models 的访问，并为 general 与 coding workloads 提供独立 endpoints。

- Providers: `volcengine`（general）+ `volcengine-plan`（coding）
- Auth: `VOLCANO_ENGINE_API_KEY`
- API: OpenAI-compatible

## Quick start

1. 设置 API key：

在 CrawClaw Desktop 中打开 **Settings → Models and replies → Add model**，
选择 Volcengine，粘贴 Volcano Engine API key，并保存 general
`volcengine/<model>` profile 或 coding `volcengine-plan/<model>` profile。连接
probe 通过后，Desktop 会把 key 存为本地 file SecretRef。

2. 设置 default model：

```json5
{
  agents: {
    defaults: {
      model: { primary: "volcengine-plan/ark-code-latest" },
    },
  },
}
```

## Non-interactive example

在 headless hosts 上，将 `VOLCANO_ENGINE_API_KEY` 设到 Gateway environment，或用
`config.patch` 将 Volcengine provider API key patch 为 `env`、`file` 或 `exec`
SecretRef。将 `agents.defaults.model.primary` 设为 `volcengine/<model>` 或
`volcengine-plan/<model>`。

## Providers and endpoints

| Provider          | Endpoint                                  | Use case       |
| ----------------- | ----------------------------------------- | -------------- |
| `volcengine`      | `ark.cn-beijing.volces.com/api/v3`        | General models |
| `volcengine-plan` | `ark.cn-beijing.volces.com/api/coding/v3` | Coding models  |

两个 providers 都由同一个 API key 配置。Setup 会自动注册两者。

## Available models

- **doubao-seed-1-8** - Doubao Seed 1.8（general, default）
- **doubao-seed-code-preview** - Doubao coding model
- **ark-code-latest** - Coding plan default
- **Kimi K2.5** - Moonshot AI via Volcano Engine
- **GLM-4.7** - GLM via Volcano Engine
- **DeepSeek V3.2** - DeepSeek via Volcano Engine

大多数 models 支持 text + image input。Context windows 范围从 128K 到 256K tokens。

## Environment note

如果 Gateway 作为 daemon（launchd/systemd）运行，确保 `VOLCANO_ENGINE_API_KEY` 对该 process 可用，例如放在 `~/.crawclaw/.env` 或通过 `env.shellEnv`。
