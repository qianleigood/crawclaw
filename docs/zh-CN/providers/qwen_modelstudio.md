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
  source_hash: 5d47351d3e7753ac2840eb74b60a482db47c2daac3a1bee2bb87d8c75cc42b4d
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

在 CrawClaw Desktop 中打开 **Settings → Models and replies → Add model**，
选择 Model Studio，然后选择 Standard China 或 Standard Global setup option。
Desktop 会填入匹配的 DashScope-compatible base URL，probe 选中的 model，并把 API
key 存为本地 file SecretRef。

### Coding Plan（subscription）

使用同一个 Desktop flow，但选择 Coding Plan China 或 Coding Plan Global。在
headless hosts 上，将 `MODELSTUDIO_API_KEY` 设到 Gateway environment，或用
`config.patch` 写入 provider `baseUrl`、model defaults，以及 SecretRef-backed
`models.providers.modelstudio.apiKey`。

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
