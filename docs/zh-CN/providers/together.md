---
read_when:
  - 你想在 CrawClaw 中使用 Together AI
  - 你需要 API 密钥环境变量或 CLI 认证选项
summary: Together AI 设置（认证 + 模型选择）
title: Together AI
x-i18n:
  generated_at: "2026-06-05T14:45:27Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 7807e6730d8a60cadc0d5bb669704ceaf93a1baa330253a8e00b10bb00328ca0
  source_path: providers/together.md
  workflow: 15
---

# Together AI

[Together AI](https://together.ai) 提供对包括 Llama、DeepSeek、Kimi 等在内的领先开源模型的访问，通过统一 API 实现。

- 提供商：`together`
- 认证：`TOGETHER_API_KEY`
- API：OpenAI 兼容

## 快速开始

1. 设置 API 密钥（推荐：为 Gateway 存储）：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 实现自动化。

2. 设置默认模型：

```json5
{
  agents: {
    defaults: {
      model: { primary: "together/moonshotai/Kimi-K2.5" },
    },
  },
}
```

## 非交互式示例

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 实现自动化。

这会将 `together/moonshotai/Kimi-K2.5` 设置为默认模型。

## 环境说明

如果 Gateway 作为守护进程运行（launchd/systemd），请确保 `TOGETHER_API_KEY`对该进程可用（例如，在 `~/.crawclaw/.env` 中或通过 `env.shellEnv`）。

## 可用模型

Together AI 提供对多种流行开源模型的访问：

- **GLM 4.7 Fp8** - 默认模型，200K 上下文窗口
- **Llama 3.3 70B Instruct Turbo** - 快速、高效的指令遵循
- **Llama 4 Scout** - 具有图像理解能力的视觉模型
- **Llama 4 Maverick** - 先进的视觉和推理能力
- **DeepSeek V3.1** - 强大的编码和推理模型
- **DeepSeek R1** - 先进的推理模型
- **Kimi K2 Instruct** - 高性能模型，262K 上下文窗口

所有模型都支持标准聊天补全并与 OpenAI API 兼容。
