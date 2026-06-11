---
read_when:
  - 你想在 CrawClaw 中使用 OpenAI 模型
  - 你需要 OpenAI API 密钥设置指导
summary: 通过 API 密钥在 CrawClaw 中使用 OpenAI
title: OpenAI
x-i18n:
  generated_at: "2026-06-05T14:45:00Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 913d27ed6b50babb4693a40b7eab315a9707aab7fa20f1c480c940f3af6c9e85
  source_path: providers/openai.md
  workflow: 15
---

# OpenAI

OpenAI 为 GPT 模型提供开发者 API。CrawClaw 捆绑的 OpenAI 设置使用 API 密钥；旧的捆绑式 Codex OAuth 登录辅助程序已从产品运行时边界中移除。

## 选项 A：OpenAI API 密钥（OpenAI Platform）

**最适合：** 直接 API 访问和按用量计费。
从 OpenAI 仪表板获取你的 API 密钥。

### Desktop 设置

在 CrawClaw Desktop 中打开 **Settings → Models and replies → Add model**，
选择 OpenAI，粘贴 OpenAI API key，并保存 `openai/<model>` profile。连接 probe
通过后，Desktop 会把 key 存为本地 file SecretRef。

在 headless hosts 上，将 `OPENAI_API_KEY` 设到 Gateway environment，或用
`config.patch` 将 `models.providers.openai.apiKey` patch 为 `env`、`file` 或
`exec` SecretRef。

### 配置片段

```json5
{
  env: { OPENAI_API_KEY: "sk-..." },
  agents: { defaults: { model: { primary: "openai/gpt-5.4" } } },
}
```

OpenAI 当前的 API 模型文档列出了 `gpt-5.4` 和 `gpt-5.4-pro` 用于直接 OpenAI API 使用。CrawClaw 通过 `openai/*` Responses 路径转发两者。CrawClaw 有意抑制了过时的 `openai/gpt-5.3-codex-spark` 条目，因为直接 OpenAI API 调用在实时流量中会拒绝它。

CrawClaw **不**在直接 OpenAI API 路径上暴露 `openai/gpt-5.3-codex-spark`，因为实时 OpenAI API 请求会拒绝它。Spark 在 CrawClaw 中被视为仅限 Codex。

## OpenAI Code（Codex）

`openai-codex/*` 模型系列保留在模型目录中，供已有兼容 token 配置或外部工具的用户使用，但 CrawClaw 不再启动捆绑的 JavaScript Codex OAuth 流程。

### 配置片段（Codex 订阅）

```json5
{
  agents: { defaults: { model: { primary: "openai-codex/gpt-5.4" } } },
}
```

OpenAI 当前的 Codex 文档将 `gpt-5.4` 列为当前 Codex 模型。当兼容的 Codex 认证已可用时，CrawClaw 将其映射到 `openai-codex/gpt-5.4`。

如果你的 Codex 账户有资格使用 Codex Spark，CrawClaw 也支持：

- `openai-codex/gpt-5.3-codex-spark`

CrawClaw 将 Codex Spark 视为仅限 Codex。它不暴露直接的 `openai/gpt-5.3-codex-spark` API 密钥路径。

当兼容的 Codex 认证和目录元数据暴露它时，CrawClaw 也会保留 `openai-codex/gpt-5.3-codex-spark`。将其视为取决于授权的且实验性的：Codex Spark 独立于 GPT-5.4 `/fast`，可用性取决于登录的 Codex / ChatGPT 账户。

### 传输默认值

CrawClaw 使用其 Rust NativeProvider 传输进行模型流式传输。对于 `openai/*` 和 `openai-codex/*`，默认传输为 `"auto"`（优先 WebSocket，然后 SSE 回退）。

你可以设置 `agents.defaults.models.<provider/model>.params.transport`：

- `"sse"`：强制使用 SSE
- `"websocket"`：强制使用 WebSocket
- `"auto"`：尝试 WebSocket，然后回退到 SSE

对于 `openai/*`（Responses API），当使用 WebSocket 传输时，CrawClaw 默认还启用 WebSocket 预热（`openaiWsWarmup: true`）。

相关 OpenAI 文档：

- [通过 WebSocket 的 Realtime API](https://platform.openai.com/docs/guides/realtime-websocket)
- [流式 API 响应（SSE）](https://platform.openai.com/docs/guides/streaming-responses)

```json5
{
  agents: {
    defaults: {
      model: { primary: "openai-codex/gpt-5.4" },
      models: {
        "openai-codex/gpt-5.4": {
          params: {
            transport: "auto",
          },
        },
      },
    },
  },
}
```

### OpenAI WebSocket 预热

OpenAI 文档将预热描述为可选的。CrawClaw 为 `openai/*` 默认启用它，以减少使用 WebSocket 传输时的首次响应延迟。

### 禁用预热

```json5
{
  agents: {
    defaults: {
      models: {
        "openai/gpt-5.4": {
          params: {
            openaiWsWarmup: false,
          },
        },
      },
    },
  },
}
```

### 显式启用预热

```json5
{
  agents: {
    defaults: {
      models: {
        "openai/gpt-5.4": {
          params: {
            openaiWsWarmup: true,
          },
        },
      },
    },
  },
}
```

### OpenAI 和 Codex 优先级处理

OpenAI 的 API 通过 `service_tier=priority` 公开优先级处理。在 CrawClaw 中，设置 `agents.defaults.models["<provider>/<model>"].params.serviceTier` 以在该字段上传递，以在原生 OpenAI/Codex Responses 端点上传递。

```json5
{
  agents: {
    defaults: {
      models: {
        "openai/gpt-5.4": {
          params: {
            serviceTier: "priority",
          },
        },
        "openai-codex/gpt-5.4": {
          params: {
            serviceTier: "priority",
          },
        },
      },
    },
  },
}
```

支持的值有 `auto`、`default`、`flex` 和 `priority`。

当这些模型指向原生 OpenAI/Codex 端点时，CrawClaw 将 `params.serviceTier` 转发到直接的 `openai/*` Responses 请求和 `openai-codex/*` Codex Responses 请求。

重要行为：

- 直接 `openai/*` 必须以 `api.openai.com` 为目标
- `openai-codex/*` 必须以 `chatgpt.com/backend-api` 为目标
- 如果你通过另一个 base URL 或代理路由任一提供商，CrawClaw 不会触碰 `service_tier`

### OpenAI 快速模式

CrawClaw 为 `openai/*` 和 `openai-codex/*` 会话公开共享的快速模式切换：

- 聊天/UI：`/fast status|on|off`
- 配置：`agents.defaults.models["<provider>/<model>"].params.fastMode`

当快速模式启用时，CrawClaw 将其映射到 OpenAI 优先级处理：

- 发送到 `api.openai.com` 的直接 `openai/*` Responses 调用会发送 `service_tier = "priority"`
- 发送到 `chatgpt.com/backend-api` 的 `openai-codex/*` Responses 调用也会发送 `service_tier = "priority"`
- 保留现有的 payload `service_tier` 值
- 快速模式不会重写 `reasoning` 或 `text.verbosity`

示例：

```json5
{
  agents: {
    defaults: {
      models: {
        "openai/gpt-5.4": {
          params: {
            fastMode: true,
          },
        },
        "openai-codex/gpt-5.4": {
          params: {
            fastMode: true,
          },
        },
      },
    },
  },
}
```

会话覆盖优先于配置。在会话 UI 中清除会话覆盖会使会话返回到配置的默认值。

### OpenAI Responses 服务器端压缩

对于直接 OpenAI Responses 模型（`openai/*` 使用 `api: "openai-responses"` 且 `baseUrl` 在 `api.openai.com` 上），CrawClaw 现在自动启用 OpenAI 服务器端压缩 payload 提示：

- 强制 `store: true`（除非模型 compat 设置 `supportsStore: false`）
- 注入 `context_management: [{ type: "compaction", compact_threshold: ... }]`

默认情况下，`compact_threshold` 是模型 `contextWindow` 的 `70%`（或不可用时的 `80000`）。

### 显式启用服务器端压缩

当你想在兼容的 Responses 模型上强制 `context_management` 注入时使用此选项（例如 Azure OpenAI Responses）：

```json5
{
  agents: {
    defaults: {
      models: {
        "azure-openai-responses/gpt-5.4": {
          params: {
            responsesServerCompaction: true,
          },
        },
      },
    },
  },
}
```

### 使用自定义阈值启用

```json5
{
  agents: {
    defaults: {
      models: {
        "openai/gpt-5.4": {
          params: {
            responsesServerCompaction: true,
            responsesCompactThreshold: 120000,
          },
        },
      },
    },
  },
}
```

### 禁用服务器端压缩

```json5
{
  agents: {
    defaults: {
      models: {
        "openai/gpt-5.4": {
          params: {
            responsesServerCompaction: false,
          },
        },
      },
    },
  },
}
```

`responsesServerCompaction` 仅控制 `context_management` 注入。直接 OpenAI Responses 模型仍然强制 `store: true`，除非 compat 设置 `supportsStore: false`。

## 注意事项

- 模型引用始终使用 `provider/model`（参见 [/concepts/models](/concepts/models)）。
- 认证详情和重用规则在 [/concepts/oauth](/concepts/oauth) 中。
