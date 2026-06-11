---
read_when:
  - 你想在 CrawClaw 中使用 Anthropic 模型
  - 你想使用 setup-token 而不是 API 密钥
  - 你想在 Gateway 主机上重用 Claude CLI 订阅认证
summary: 通过 API 密钥、setup-token 或 Claude CLI 在 CrawClaw 中使用 Anthropic Claude
title: Anthropic
x-i18n:
  generated_at: "2026-06-05T14:43:05Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: e0a17d050999489cff0883ee9a3afded16b699f003e8f1d3b50233c2a1b84f8c
  source_path: providers/anthropic.md
  workflow: 15
---

# Anthropic (Claude)

Anthropic 构建了 **Claude** 模型系列并通过 API 提供访问。在 CrawClaw 中，你可以使用 API 密钥或 **setup-token** 进行认证。

## 选项 A：Anthropic API 密钥

**最适合：**标准 API 访问和按量计费。
在 Anthropic Console 中创建你的 API 密钥。

### Desktop 设置

打开 **CrawClaw Desktop → Settings → Models and replies → Add model**，选择
**Anthropic API key**，粘贴 key，并选择默认 Claude 模型。对于 headless hosts，将
`ANTHROPIC_API_KEY` 暴露给 Gateway 进程，或通过 SecretRef 引用它，而不是把 raw
key 存在共享 config 中。

### Claude CLI 配置片段

```json5
{
  env: { ANTHROPIC_API_KEY: "sk-ant-..." },
  agents: { defaults: { model: { primary: "anthropic/claude-opus-4-6" } } },
}
```

## 思考默认值（Claude 4.6）

- Anthropic Claude 4.6 模型在未设置显式思考级别时，在 CrawClaw 中默认为 `adaptive` 思考。
- 你可以按消息覆盖（`/think:<level>`）或在模型参数中：
  `agents.defaults.models["anthropic/<model>"].params.thinking`。
- 相关 Anthropic 文档：
  - [自适应思考](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking)
  - [扩展思考](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)

## 快速模式（Anthropic API）

CrawClaw 的共享 `/fast` 切换也支持直接公共 Anthropic 流量，包括发送到 `api.anthropic.com` 的 API 密钥和 OAuth 认证请求。

- `/fast on` 映射到 `service_tier: "auto"`
- `/fast off` 映射到 `service_tier: "standard_only"`
- 配置默认值：

```json5
{
  agents: {
    defaults: {
      models: {
        "anthropic/claude-sonnet-4-6": {
          params: { fastMode: true },
        },
      },
    },
  },
}
```

重要限制：

- CrawClaw 仅对直接 `api.anthropic.com` 请求注入 Anthropic 服务层级。如果你通过代理或网关路由 `anthropic/*`，`/fast` 不会修改 `service_tier`。
- 显式 Anthropic `serviceTier` 或 `service_tier` 模型参数在两者都设置时覆盖 `/fast` 默认值。
- Anthropic 在响应的 `usage.service_tier` 下报告有效层级。在没有 Priority Tier 容量的账户上，`service_tier: "auto"` 可能仍会解析为 `standard`。

## 提示缓存（Anthropic API）

CrawClaw 支持 Anthropic 的提示缓存功能。这是**仅 API**的；订阅认证不遵守缓存设置。

### 配置

在模型配置中使用 `cacheRetention` 参数：

| 值      | 缓存持续时间 | 描述                       |
| ------- | ------------ | -------------------------- |
| `none`  | 无缓存       | 禁用提示缓存               |
| `short` | 5 分钟       | API 密钥认证的默认值       |
| `long`  | 1 小时       | 扩展缓存（需要 beta 标志） |

```json5
{
  agents: {
    defaults: {
      models: {
        "anthropic/claude-opus-4-6": {
          params: { cacheRetention: "long" },
        },
      },
    },
  },
}
```

### 默认值

使用 Anthropic API 密钥认证时，CrawClaw 自动为所有 Anthropic 模型应用 `cacheRetention: "short"`（5 分钟缓存）。你可以通过在配置中显式设置 `cacheRetention` 来覆盖它。

### 按智能体覆盖 cacheRetention

使用模型级参数作为基线，然后通过 `agents.list[].params` 覆盖特定智能体。

```json5
{
  agents: {
    defaults: {
      model: { primary: "anthropic/claude-opus-4-6" },
      models: {
        "anthropic/claude-opus-4-6": {
          params: { cacheRetention: "long" }, // 大多数智能体的基线
        },
      },
    },
    list: [
      { id: "research", default: true },
      { id: "alerts", params: { cacheRetention: "none" } }, // 仅覆盖此智能体
    ],
  },
}
```

缓存相关参数的配置合并顺序：

1. `agents.defaults.models["provider/model"].params`
2. `agents.list[].params`（匹配 `id`，按键覆盖）

这允许一个智能体在同一模型上保持长期缓存，而另一个智能体禁用缓存以避免突发/低重用流量的写入成本。

### Bedrock Claude 注意事项

- Bedrock 上的 Anthropic Claude 模型（`amazon-bedrock/*anthropic.claude*`）在配置时接受 `cacheRetention` 直通。
- 非 Anthropic Bedrock 模型在运行时被强制为 `cacheRetention: "none"`。
- Anthropic API 密钥智能默认值也在未设置显式值时为 Claude-on-Bedrock 模型引用植入 `cacheRetention: "short"`。

### 旧版参数

较旧的 `cacheControlTtl` 参数仍被支持以保持向后兼容：

- `"5m"` 映射到 `short`
- `"1h"` 映射到 `long`

我们建议迁移到新的 `cacheRetention` 参数。

CrawClaw 为 Anthropic API 请求包含 `extended-cache-ttl-2025-04-11` beta 标志；如果你覆盖提供商标头，请保留它（参见 [/gateway/configuration](/gateway/configuration)）。

## 1M 上下文窗口（Anthropic beta）

Anthropic 的 1M 上下文窗口是 beta 门控的。在 CrawClaw 中，为支持的 Opus/Sonnet 模型在每个模型上使用 `params.context1m: true` 启用它。

```json5
{
  agents: {
    defaults: {
      models: {
        "anthropic/claude-opus-4-6": {
          params: { context1m: true },
        },
      },
    },
  },
}
```

CrawClaw 在 Anthropic 请求上映射到 `anthropic-beta: context-1m-2025-08-07`。

仅当该模型的 `params.context1m` 显式设置为 `true` 时才激活。

要求：Anthropic 必须允许该凭证使用长上下文（通常是 API 密钥计费，或启用了 Extra Usage 的订阅账户）。否则 Anthropic 返回：
`HTTP 429: rate_limit_error: Extra usage is required for long context requests`。

注意：Anthropic 目前在使用订阅 setup-token（`sk-ant-oat-*`）时拒绝 `context-1m-*` beta 请求。如果你使用订阅认证配置了 `context1m: true`，CrawClaw 记录警告并通过跳过 context1m beta 标头同时保留所需的 OAuth beta 来回退到标准上下文窗口。

## 选项 B：Claude setup-token

**最适合：**使用你的 Claude 订阅。

### 获取 setup-token 的位置

Setup-token 由 **Claude Code CLI** 创建，而非 Anthropic Console。你可以在**任何机器**上运行：

```bash
claude setup-token
```

将令牌粘贴到 CrawClaw（向导：**Anthropic token（粘贴 setup-token）**），或在 Gateway 主机上运行：

尽量在 Gateway host 上运行 `claude setup-token`，然后把 token 粘贴到目标 agent 的
Desktop **Anthropic token (paste setup-token)** flow。

如果你在不同的机器上生成了令牌，请粘贴它：

把 setup-token 复制到 Gateway host，并粘贴到同一个 Desktop setup-token flow。对于
headless hosts，配置目标 agent 的 `auth-profiles.json`，并通过 `auth.profiles` /
`auth.order` 路由；不要把 live setup-tokens 放进 `crawclaw.json`。

### Desktop 设置（setup-token）

打开 **CrawClaw Desktop → Settings → Models and replies → Add model**，选择
**Anthropic token (paste setup-token)**，粘贴 setup-token，并保存到目标 agent
profile。

### 配置片段（setup-token）

```json5
{
  agents: { defaults: { model: { primary: "anthropic/claude-opus-4-6" } } },
}
```

## 注意事项

- 使用 `claude setup-token` 生成 setup-token 并粘贴，或在 Gateway 主机上运行 CrawClaw Desktop 或本地 Gateway API。
- 如果 Claude 订阅令牌过期或被拒绝，请使用 setup-token 重新认证。参见 [/gateway/troubleshooting](/gateway/troubleshooting)。
- 认证详情 + 重用规则在 [/concepts/oauth](/concepts/oauth) 中。

## 故障排除

**401 错误 / 令牌突然无效**

- Claude 订阅认证可能会过期或被撤销。重新运行 `claude setup-token` 并将其粘贴到 **Gateway 主机**上。
- 如果 Claude CLI 登录在不同的机器上，请在 Gateway 主机上使用 CrawClaw Desktop 或本地 Gateway API。

**找不到提供商 "anthropic" 的 API 密钥**

- 认证是**按智能体**的。新智能体不会继承主智能体的密钥。
- 为该智能体重新运行入门，或在 Gateway 主机上粘贴 setup-token / API 密钥，然后使用 CrawClaw Desktop 或本地 Gateway API 进行验证。

**找不到配置 `anthropic:default` 的凭证**

- 运行 CrawClaw Desktop 或本地 Gateway API 查看哪个认证配置是活跃的。
- 重新运行入门，或为该配置粘贴 setup-token / API 密钥。

**没有可用的认证配置（全部在冷却中/不可用）**

- 检查 CrawClaw Desktop 或本地 Gateway API 的 `auth.unusableProfiles`。
- 添加另一个 Anthropic 配置或等待冷却。

更多：[/gateway/troubleshooting](/gateway/troubleshooting) 和 [/help/faq](/help/faq)。
