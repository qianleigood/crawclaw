---
title: "Qwen / Model Studio"
summary: "Alibaba Cloud Model Studio 设置（Standard pay-as-you-go 和 Coding Plan，dual region endpoints）"
read_when:
  - 你想在 CrawClaw 中使用 Qwen（Alibaba Cloud Model Studio）
  - 你需要 Model Studio 的 API key env var
  - 你想使用 Standard（pay-as-you-go）或 Coding Plan endpoint
x-i18n:
  generated_at: "2026-06-10T11:23:26Z"
  model: codex
  provider: openai
  source_hash: 96d45fb15075149e5148c2e14840d98327f7d1e12e3d98d657ad64cd8d2a16cf
  source_path: providers/qwen_modelstudio.md
  workflow: 15
---

# Qwen / Model Studio (Alibaba Cloud)

Model Studio provider 提供 Alibaba Cloud models 访问能力，包括 Qwen 和平台托管的 third-party models。支持两种 billing plans：**Standard**（pay-as-you-go）和 **Coding Plan**（subscription）。

- Provider: `modelstudio`
- Auth: `MODELSTUDIO_API_KEY`
- API: OpenAI-compatible

## Quick start

### Standard（pay-as-you-go）

使用 CrawClaw Desktop 进行交互式 setup，或调用本地 Gateway API 做自动化。

### Coding Plan（subscription）

使用 CrawClaw Desktop 进行交互式 setup，或调用本地 Gateway API 做自动化。

onboarding 后，设置 default model：

```json5
{
  agents: {
    defaults: {
      model: { primary: "modelstudio/qwen3.5-plus" },
    },
  },
}
```

## Plan types and endpoints

| Plan                       | Region | Auth choice                       | Endpoint                                         |
| -------------------------- | ------ | --------------------------------- | ------------------------------------------------ |
| Standard (pay-as-you-go)   | China  | `modelstudio-standard-api-key-cn` | `dashscope.aliyuncs.com/compatible-mode/v1`      |
| Standard (pay-as-you-go)   | Global | `modelstudio-standard-api-key`    | `dashscope-intl.aliyuncs.com/compatible-mode/v1` |
| Coding Plan (subscription) | China  | `modelstudio-api-key-cn`          | `coding.dashscope.aliyuncs.com/v1`               |
| Coding Plan (subscription) | Global | `modelstudio-api-key`             | `coding-intl.dashscope.aliyuncs.com/v1`          |

provider 会根据你的 auth choice 自动选择 endpoint。你可以在 config 中用 custom `baseUrl` 覆盖。

## Get your API key

- **China**: [bailian.console.aliyun.com](https://bailian.console.aliyun.com/)
- **Global/Intl**: [modelstudio.console.alibabacloud.com](https://modelstudio.console.alibabacloud.com/)

## Available models

- **qwen3.5-plus**（default）— Qwen 3.5 Plus
- **qwen3-coder-plus**, **qwen3-coder-next** — Qwen coding models
- **GLM-5** — GLM models via Alibaba
- **Kimi K2.5** — Moonshot AI via Alibaba
- **MiniMax-M2.7** — MiniMax via Alibaba

部分 models（qwen3.5-plus、kimi-k2.5）支持 image input。Context windows 范围从 200K 到 1M tokens。

## Environment note

如果 Gateway 作为 daemon（launchd/systemd）运行，确保 `MODELSTUDIO_API_KEY` 对该 process 可用，例如放在 `~/.crawclaw/.env` 或通过 `env.shellEnv`。
