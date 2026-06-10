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
  source_hash: 2028fc46971436f09102245acc8fe0563b2c7b5273de7968f8d91410e5a7abd4
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

使用 CrawClaw Desktop 进行交互式 setup，或调用本地 Gateway API 做自动化。

这会提示你输入 API key，并把 `deepseek/deepseek-chat` 设为 default model。

## Non-interactive example

使用 CrawClaw Desktop 进行交互式 setup，或调用本地 Gateway API 做自动化。

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
