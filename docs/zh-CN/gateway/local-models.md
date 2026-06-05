---
read_when:
  - 你想在自己的 GPU 机器上运行模型
  - 你正在配置 LM Studio 或 OpenAI 兼容代理
  - 你需要最安全的本地模型指南
summary: 在本地 LLM 上运行 CrawClaw（LM Studio、vLLM、LiteLLM、自定义 OpenAI 端点）
title: 本地模型
x-i18n:
  generated_at: "2026-06-05T14:17:50Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 5247e663c11cd7f11d5c28a70f250364b53cff9e85c5c3c601a2d98ee9f0b94d
  source_path: gateway/local-models.md
  workflow: 15
---

# 本地模型

本地运行是可行的，但 CrawClaw 期望大上下文 + 强大的提示词注入防御。小显存卡会截断上下文并泄漏安全防护。目标要高：**≥2 台满配 Mac Studio 或等效 GPU 设备（~$30k+）**。单个 **24 GB** GPU 仅适用于较轻提示词且延迟较高。使用**你能运行的最大的/完整尺寸模型变体**；激进量化或“小”检查点会增加提示词注入风险（参见[安全](/gateway/security)）。

如果你想最低摩擦力的本地设置，从 [Ollama](/providers/ollama) 和 CrawClaw Desktop 或本地 Gateway API 开始。此页面是针对高端本地堆栈和自定义 OpenAI 兼容本地服务器的意见指南。

## 推荐：LM Studio + 大型本地模型（Responses API）

目前最佳的本地堆栈。在 LM Studio 中加载大型模型（例如完整尺寸的 Qwen、DeepSeek 或 Llama 构建），启用本地服务器（默认 `http://127.0.0.1:1234`），并使用 Responses API 将推理与最终文本分开。

```json5
{
  agents: {
    defaults: {
      model: { primary: "lmstudio/my-local-model" },
      models: {
        "anthropic/claude-opus-4-6": { alias: "Opus" },
        "lmstudio/my-local-model": { alias: "Local" },
      },
    },
  },
  models: {
    mode: "merge",
    providers: {
      lmstudio: {
        baseUrl: "http://127.0.0.1:1234/v1",
        apiKey: "lmstudio",
        api: "openai-responses",
        models: [
          {
            id: "my-local-model",
            name: "Local Model",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 196608,
            maxTokens: 8192,
          },
        ],
      },
    },
  },
}
```

**设置检查清单**

- 安装 LM Studio：[https://lmstudio.ai](https://lmstudio.ai)
- 在 LM Studio 中下载**可用的最大模型构建**（避免“小”/重度量化变体），启动服务器，确认 `http://127.0.0.1:1234/v1/models` 列出了它。
- 用 LM Studio 中显示的实际模型 ID 替换 `my-local-model`。
- 保持模型加载状态；冷加载会增加启动延迟。
- 如果你的 LM Studio 构建不同，调整 `contextWindow`/`maxTokens`。
- 对于 Weixin，坚持使用 Responses API 以便只发送最终文本。

即使运行本地也保持托管模型配置；使用 `models.mode: "merge"` 以便后备保持可用。

### 混合配置：托管主模型，本地后备

```json5
{
  agents: {
    defaults: {
      model: {
        primary: "anthropic/claude-sonnet-4-6",
        fallbacks: ["lmstudio/my-local-model", "anthropic/claude-opus-4-6"],
      },
      models: {
        "anthropic/claude-sonnet-4-6": { alias: "Sonnet" },
        "lmstudio/my-local-model": { alias: "Local" },
        "anthropic/claude-opus-4-6": { alias: "Opus" },
      },
    },
  },
  models: {
    mode: "merge",
    providers: {
      lmstudio: {
        baseUrl: "http://127.0.0.1:1234/v1",
        apiKey: "lmstudio",
        api: "openai-responses",
        models: [
          {
            id: "my-local-model",
            name: "Local Model",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 196608,
            maxTokens: 8192,
          },
        ],
      },
    },
  },
}
```

### 本地优先 + 托管安全保障

交换主模型和后备的顺序；保持相同的 providers 块和 `models.mode: "merge"`，以便在本地机器宕机时可以回退到 Sonnet 或 Opus。

### 区域托管 / 数据路由

- OpenRouter 上也有托管的 MiniMax/Kimi/GLM 变体，带有区域固定端点（例如美国托管）。在那里选择区域变体以将流量保留在你选择的司法管辖区，同时仍使用 `models.mode: "merge"` 进行 Anthropic/OpenAI 回退。
- 仅本地仍然是最强的隐私路径；托管区域路由是需要提供商功能但想控制数据流时的中间方案。

## 其他 OpenAI 兼容的本地代理

vLLM、LiteLLM、OAI-proxy 或自定义网关如果暴露 OpenAI 风格的 `/v1` 端点就可以工作。用你的端点和模型 ID 替换上面的 providers 块：

```json5
{
  models: {
    mode: "merge",
    providers: {
      local: {
        baseUrl: "http://127.0.0.1:8000/v1",
        apiKey: "sk-local",
        api: "openai-responses",
        models: [
          {
            id: "my-local-model",
            name: "Local Model",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 120000,
            maxTokens: 8192,
          },
        ],
      },
    },
  },
}
```

保持 `models.mode: "merge"` 以便托管模型作为后备保持可用。

## 故障排除

- Gateway 能访问代理吗？`curl http://127.0.0.1:1234/v1/models`。
- LM Studio 模型未加载？重新加载；冷启动是常见的“挂起”原因。
- 上下文错误？降低 `contextWindow` 或提高服务器限制。
- 安全：本地模型跳过提供商端过滤器；保持智能体范围受限并开启压缩以限制提示词注入爆炸半径。
