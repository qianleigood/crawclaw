---
read_when:
  - 你想选择一个模型提供商
  - 你想要 LLM 认证和模型选择的快速设置示例
summary: CrawClaw 支持的模型提供商（LLM）
title: 模型提供商快速入门
x-i18n:
  generated_at: "2026-06-05T14:44:29Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 0e7fe5b05bae59f97bf3ea9161418358aebfbbb77e0064934c103b4103d69c7c
  source_path: providers/models.md
  workflow: 15
---

# 模型提供商

CrawClaw 可以使用多种 LLM 提供商。选择一个进行认证，然后将默认模型设置为 `provider/model`。

## 快速开始（两个步骤）

1. 通过提供商进行认证（通常通过 CrawClaw Desktop 或本地 Gateway API）。
2. 设置默认模型：

```json5
{
  agents: { defaults: { model: { primary: "anthropic/claude-opus-4-6" } } },
}
```

## 支持的提供商（入门集）

- [OpenAI（API + Codex）](/providers/openai)
- [Anthropic（API + Claude Code CLI）](/providers/anthropic)
- [OpenRouter](/providers/openrouter)
- [Vercel AI Gateway](/providers/vercel-ai-gateway)
- [Cloudflare AI Gateway](/providers/cloudflare-ai-gateway)
- [Moonshot AI（Kimi + Kimi Coding）](/providers/moonshot)
- [Mistral](/providers/mistral)
- [Synthetic](/providers/synthetic)
- [OpenCode（Zen + Go）](/providers/opencode)
- [Z.AI](/providers/zai)
- [GLM 模型](/providers/glm)
- [MiniMax](/providers/minimax)
- [Venice（Venice AI）](/providers/venice)
- [Amazon Bedrock](/providers/bedrock)
- [Qianfan](/providers/qianfan)
- [xAI](/providers/xai)

完整的提供商目录（xAI、Groq、Mistral 等）和高级配置，请参阅[模型提供商](/concepts/model-providers)。
