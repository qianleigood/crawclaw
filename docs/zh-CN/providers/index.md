---
read_when:
  - 你想选择一个模型提供商
  - 你需要支持的 LLM 后端快速概览
summary: CrawClaw 支持的模型提供商（LLM）
title: 提供商目录
x-i18n:
  generated_at: "2026-06-05T14:43:40Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: e2ad843eb0b16dc0f44f914b8c67f071791b987b3335818acec6d49f74498d21
  source_path: providers/index.md
  workflow: 15
---

# 模型提供商

CrawClaw 可以使用多种 LLM 提供商。选择提供商、认证，然后设置默认模型为 `provider/model`。

在找聊天渠道文档（Weixin/Feishu/community chat/Feishu/native channels (plugin)/等）？请参阅 [Channels](/channels)。

## 快速开始

1. 通过提供商认证（通常通过 CrawClaw Desktop 或本地 Gateway API）。
2. 设置默认模型：

```json5
{
  agents: { defaults: { model: { primary: "anthropic/claude-opus-4-6" } } },
}
```

## 提供商文档

- [Amazon Bedrock](/providers/bedrock)
- [Anthropic（API + Claude Code CLI）](/providers/anthropic)
- [Chutes](/providers/chutes)
- [Cloudflare AI Gateway](/providers/cloudflare-ai-gateway)
- [DeepSeek](/providers/deepseek)
- [GitHub Copilot](/providers/github-copilot)
- [GLM 模型](/providers/glm)
- [Google（Gemini）](/providers/google)
- [Groq（LPU 推理）](/providers/groq)
- [Hugging Face（推理）](/providers/huggingface)
- [Kilocode](/providers/kilocode)
- [LiteLLM（统一网关）](/providers/litellm)
- [MiniMax](/providers/minimax)
- [Mistral](/providers/mistral)
- [Moonshot AI（Kimi + Kimi Coding）](/providers/moonshot)
- [NVIDIA](/providers/nvidia)
- [Ollama（云 + 本地模型）](/providers/ollama)
- [OpenAI（API + Codex）](/providers/openai)
- [OpenCode](/providers/opencode)
- [OpenCode Go](/providers/opencode-go)
- [OpenRouter](/providers/openrouter)
- [Qianfan](/providers/qianfan)
- [Qwen / Model Studio（阿里云）](/providers/qwen_modelstudio)
- [SGLang（本地模型）](/providers/sglang)
- [Synthetic](/providers/synthetic)
- [Together AI](/providers/together)
- [Venice（Venice AI，注重隐私）](/providers/venice)
- [Vercel AI Gateway](/providers/vercel-ai-gateway)
- [vLLM（本地模型）](/providers/vllm)
- [Volcengine（豆包）](/providers/volcengine)
- [xAI](/providers/xai)
- [Xiaomi](/providers/xiaomi)
- [Z.AI](/providers/zai)

## 转录提供商

- [Deepgram（音频转录）](/providers/deepgram)

## 社区工具

- [Claude Max API Proxy](/providers/claude-max-api-proxy) - Claude 订阅凭证的社区代理（使用前请验证 Anthropic 政策/条款）

有关完整的提供商目录（xAI、Groq、Mistral 等）和高级配置，请参阅[模型提供商](/concepts/model-providers)。
