---
title: "DeepSeek"
summary: "DeepSeek setup (auth + model selection)"
read_when:
  - You want to use DeepSeek with CrawClaw
  - You need the API key env var or CLI auth choice
---

# DeepSeek

[DeepSeek](https://www.deepseek.com) provides powerful AI models with an OpenAI-compatible API.

- Provider: `deepseek`
- Auth: `DEEPSEEK_API_KEY`
- API: OpenAI-compatible

## Quick start

Set the API key (recommended: store it for the Gateway):

Open **Settings → Models and replies → Add model** in CrawClaw Desktop, choose
DeepSeek, paste your API key, and save a `deepseek/<model>` profile. Desktop
stores the key as a local file SecretRef after the connection probe succeeds.

This will prompt for your API key and set `deepseek/deepseek-chat` as the default model.

## Non-interactive example

For headless hosts, set `DEEPSEEK_API_KEY` in the Gateway environment or patch
`models.providers.deepseek.apiKey` to an `env`, `file`, or `exec` SecretRef
with `config.patch`. Set `agents.defaults.model.primary` to
`deepseek/deepseek-chat` or `deepseek/deepseek-reasoner`.

## Environment note

If the Gateway runs as a daemon (launchd/systemd), make sure `DEEPSEEK_API_KEY`
is available to that process (for example, in `~/.crawclaw/.env` or via
`env.shellEnv`).

## Available models

| Model ID            | Name                     | Type      | Context |
| ------------------- | ------------------------ | --------- | ------- |
| `deepseek-chat`     | DeepSeek Chat (V3.2)     | General   | 128K    |
| `deepseek-reasoner` | DeepSeek Reasoner (V3.2) | Reasoning | 128K    |

- **deepseek-chat** corresponds to DeepSeek-V3.2 in non-thinking mode.
- **deepseek-reasoner** corresponds to DeepSeek-V3.2 in thinking mode with chain-of-thought reasoning.

Get your API key at [platform.deepseek.com](https://platform.deepseek.com/api_keys).
