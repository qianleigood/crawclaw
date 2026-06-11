---
title: "DeepSeek"
summary: "DeepSeek 设置（auth + model selection）"
read_when:
  - 你想在 CrawClaw 中使用 DeepSeek
  - 你需要 API key env var 或 CLI auth choice
x-i18n:
  generated_at: "2026-06-10T11:23:26Z"
  model: codex
  provider: openai
  source_hash: 4e61adf4fa6ca455ae6fd68c8efd1c7a3128ed3ed52e061529ef845b127cd3d9
  source_path: providers/deepseek.md
  workflow: 15
---

# DeepSeek

[DeepSeek](https://www.deepseek.com) 通过 OpenAI-compatible API 提供强大的 AI models。

- Provider: `deepseek`
- Auth: `DEEPSEEK_API_KEY`
- API: OpenAI-compatible

## Quick start

设置 API key（推荐：为 Gateway 存储）：

在 CrawClaw Desktop 中打开 **Settings → Models and replies → Add model**，
选择 DeepSeek，粘贴 API key，并保存 `deepseek/<model>` profile。连接 probe
通过后，Desktop 会把 key 存为本地 file SecretRef。

这会提示你输入 API key，并把 `deepseek/deepseek-chat` 设为 default model。

## Non-interactive example

在 headless hosts 上，将 `DEEPSEEK_API_KEY` 设到 Gateway environment，或用
`config.patch` 将 `models.providers.deepseek.apiKey` patch 为 `env`、`file`
或 `exec` SecretRef。将 `agents.defaults.model.primary` 设为
`deepseek/deepseek-chat` 或 `deepseek/deepseek-reasoner`。

## Environment note

如果 Gateway 作为 daemon（launchd/systemd）运行，确保 `DEEPSEEK_API_KEY` 对该 process 可用，例如放在 `~/.crawclaw/.env` 或通过 `env.shellEnv`。

## Available models

| Model ID            | Name                     | Type      | Context |
| ------------------- | ------------------------ | --------- | ------- |
| `deepseek-chat`     | DeepSeek Chat (V3.2)     | General   | 128K    |
| `deepseek-reasoner` | DeepSeek Reasoner (V3.2) | Reasoning | 128K    |

- **deepseek-chat** 对应 non-thinking mode 的 DeepSeek-V3.2。
- **deepseek-reasoner** 对应 thinking mode 且带 chain-of-thought reasoning 的 DeepSeek-V3.2。

在 [platform.deepseek.com](https://platform.deepseek.com/api_keys) 获取 API key。
