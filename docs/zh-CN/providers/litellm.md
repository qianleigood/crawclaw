---
read_when:
  - 你想通过 LiteLLM 代理路由 CrawClaw
  - 你需要通过 LiteLLM 进行成本跟踪、日志或模型路由
summary: 通过 LiteLLM Proxy 运行 CrawClaw，实现统一模型访问和成本跟踪
title: LiteLLM
x-i18n:
  generated_at: "2026-06-05T14:44:13Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 1ba47261b8900ad6e2ce9097ed71a6865ad09aff0472aaade0013615e6b8b9bb
  source_path: providers/litellm.md
  workflow: 15
---

# LiteLLM

[LiteLLM](https://litellm.ai) 是一个开源 LLM 网关，提供统一的 API 接口访问 100+ 模型提供商。通过 LiteLLM 路由 CrawClaw，获得集中式成本跟踪、日志记录，以及无需更改 CrawClaw 配置即可切换后端的灵活性。

## 为什么将 LiteLLM 与 CrawClaw 一起使用？

- **成本跟踪** — 精确查看 CrawClaw 在所有模型上的支出
- **模型路由** — 无需更改配置即可在 Claude、GPT-4、Gemini、Bedrock 之间切换
- **虚拟密钥** — 为 CrawClaw 创建有消费限额的密钥
- **日志记录** — 完整的请求/响应日志用于调试
- **回退机制** — 主提供商宕机时自动故障转移

## 快速开始

### 通过入门引导

在 CrawClaw Desktop 中打开 **Settings → Models and replies → Add model**，
选择 LiteLLM，输入 LiteLLM proxy base URL，如果你的 proxy 需要认证则粘贴 LiteLLM
virtual key，并保存 `litellm/<model>` profile。

在 headless hosts 上，将 `LITELLM_API_KEY` 设到 Gateway environment，或用
`config.patch` 将 `models.providers.litellm.apiKey` patch 为 `env`、`file` 或
`exec` SecretRef。如果不是 `http://localhost:4000/v1`，也要 patch
`models.providers.litellm.baseUrl` 为你的 proxy URL。

### 手动设置

1. 启动 LiteLLM Proxy：

```bash
pip install 'litellm[proxy]'
litellm --model claude-opus-4-6
```

2. 将 CrawClaw 指向 LiteLLM：

```bash
export LITELLM_API_KEY="your-litellm-key"

crawclaw
```

就这样。CrawClaw 现在通过 LiteLLM 路由。

## 配置

### 环境变量

```bash
export LITELLM_API_KEY="sk-litellm-key"
```

### 配置文件

```json5
{
  models: {
    providers: {
      litellm: {
        baseUrl: "http://localhost:4000",
        apiKey: "${LITELLM_API_KEY}",
        api: "openai-completions",
        models: [
          {
            id: "claude-opus-4-6",
            name: "Claude Opus 4.6",
            reasoning: true,
            input: ["text", "image"],
            contextWindow: 200000,
            maxTokens: 64000,
          },
          {
            id: "gpt-4o",
            name: "GPT-4o",
            reasoning: false,
            input: ["text", "image"],
            contextWindow: 128000,
            maxTokens: 8192,
          },
        ],
      },
    },
  },
  agents: {
    defaults: {
      model: { primary: "litellm/claude-opus-4-6" },
    },
  },
}
```

## 虚拟密钥

创建带有消费限额的 CrawClaw 专用密钥：

```bash
curl -X POST "http://localhost:4000/key/generate" \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "key_alias": "crawclaw",
    "max_budget": 50.00,
    "budget_duration": "monthly"
  }'
```

将生成的密钥用作 `LITELLM_API_KEY`。

## 模型路由

LiteLLM 可以将模型请求路由到不同的后端。在你的 LiteLLM `config.yaml` 中配置：

```yaml
model_list:
  - model_name: claude-opus-4-6
    litellm_params:
      model: claude-opus-4-6
      api_key: os.environ/ANTHROPIC_API_KEY

  - model_name: gpt-4o
    litellm_params:
      model: gpt-4o
      api_key: os.environ/OPENAI_API_KEY
```

CrawClaw 继续请求 `claude-opus-4-6` —— LiteLLM 处理路由。

## 查看使用量

检查 LiteLLM 的仪表板或 API：

```bash
# 密钥信息
curl "http://localhost:4000/key/info" \
  -H "Authorization: Bearer sk-litellm-key"

# 消费日志
curl "http://localhost:4000/spend/logs" \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY"
```

## 注意事项

- LiteLLM 默认运行在 `http://localhost:4000`
- CrawClaw 通过 OpenAI 兼容的 `/v1/chat/completions` 端点连接
- 所有 CrawClaw 功能都通过 LiteLLM 工作 —— 无限制

## 另请参阅

- [LiteLLM 文档](https://docs.litellm.ai)
- [模型提供商](/concepts/model-providers)
