---
title: "Groq"
summary: "Groq 设置（auth + model selection）"
read_when:
  - 你想在 CrawClaw 中使用 Groq
  - 你需要 API key env var 或 CLI auth choice
x-i18n:
  generated_at: "2026-06-10T11:23:26Z"
  model: codex
  provider: openai
  source_hash: b28dd88aefd09e3bf20c9e0d57acce79cadc7ba37a7536b2aa877f1af6ed982b
  source_path: providers/groq.md
  workflow: 15
---

# Groq

[Groq](https://groq.com) 使用自定义 LPU hardware，为 open-source models（Llama、Gemma、Mistral 等）提供 ultra-fast inference。CrawClaw 通过 Groq 的 OpenAI-compatible API 连接。

- Provider: `groq`
- Auth: `GROQ_API_KEY`
- API: OpenAI-compatible

## Quick start

1. 从 [console.groq.com/keys](https://console.groq.com/keys) 获取 API key。

2. 设置 API key：

```bash
export GROQ_API_KEY="gsk_..."
```

3. 设置 default model：

```json5
{
  agents: {
    defaults: {
      model: { primary: "groq/llama-3.3-70b-versatile" },
    },
  },
}
```

## Config file example

```json5
{
  env: { GROQ_API_KEY: "gsk_..." },
  agents: {
    defaults: {
      model: { primary: "groq/llama-3.3-70b-versatile" },
    },
  },
}
```

## Audio transcription

旧 TypeScript media-understanding provider path 已移除。Groq audio transcription 必须先通过 Rust-native media-understanding runtime 落地，之后才能再次暴露。

## Environment note

如果 Gateway 作为 daemon（launchd/systemd）运行，确保 `GROQ_API_KEY` 对该 process 可用，例如放在 `~/.crawclaw/.env` 或通过 `env.shellEnv`。

## Available models

Groq 的 model catalog 经常变化。运行 CrawClaw Desktop 或本地 Gateway API 查看当前可用 models，或查看 [console.groq.com/docs/models](https://console.groq.com/docs/models)。

Popular choices include:

- **Llama 3.3 70B Versatile** - general-purpose, large context
- **Llama 3.1 8B Instant** - fast, lightweight
- **Gemma 2 9B** - compact, efficient
- **Mixtral 8x7B** - MoE architecture, strong reasoning

## Links

- [Groq Console](https://console.groq.com)
- [API Documentation](https://console.groq.com/docs)
- [Model List](https://console.groq.com/docs/models)
- [Pricing](https://groq.com/pricing)
