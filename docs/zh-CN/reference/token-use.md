---
read_when:
  - 解释令牌使用情况、成本或上下文窗口
  - 调试上下文增长或压缩行为
summary: CrawClaw 如何构建提示上下文并报告令牌使用情况和成本
title: 令牌使用和成本
x-i18n:
  generated_at: "2026-06-05T14:48:47Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: aefbebe905496f3cfe9dc161e8a80b91a998fa9dda041c14d91740a85504582d
  source_path: reference/token-use.md
  workflow: 15
---

# 令牌使用和成本

CrawClaw 追踪**令牌**，而非字符。令牌是模型特定的，但大多数 OpenAI 风格模型在英文文本中平均每个令牌约 4 个字符。

## 系统提示是如何构建的

CrawClaw 在每次运行时组装自己的系统提示。它包括：

- 工具列表 + 简短描述
- Skills 列表（仅元数据；说明在需要时通过 `read` 加载）
- 自我更新说明
- 工作区引导文件。默认运行时注入故意收窄：`AGENTS.md` 用于正常运行，而 `HEARTBEAT.md` 仅在为遗留 heartbeat 兼容性路径保留。
  其他工作区文件如 `SOUL.md`、`TOOLS.md`、`IDENTITY.md`、`USER.md`、`BOOTSTRAP.md` 和 `MEMORY.md` 保持对工具/工作流或显式额外引导钩子可用，但不属于默认引导表面。
  大型注入文件通过 `agents.defaults.bootstrapMaxChars`（默认：20000）截断，总引导注入通过 `agents.defaults.bootstrapTotalMaxChars`（默认：150000）限制。`memory/*.md` 文件保持按需而非自动注入。
- 时间（UTC + 用户时区）
- 回复标签 + 事件驱动的主会话唤醒行为
- 运行时元数据（主机/操作系统/模型/思考）

参见[系统提示](/concepts/system-prompt)中的完整分解。

## 什么计入上下文窗口

模型接收的所有内容都计入上下文限制：

- 系统提示（上面列出的所有部分）
- 对话历史（用户 + 助手消息）
- 工具调用和工具结果
- 附件/成绩单（图像、音频、文件）
- 压缩摘要和修剪产物
- 提供商包装器或安全头（不可见，但仍计入）

对于图像，CrawClaw 在提供商调用之前会缩小成绩单/工具图像负载。使用 `agents.defaults.imageMaxDimensionPx`（默认：`1200`）调整：

- 较低的值通常会降低视觉令牌使用量和负载大小。
- 较高的值为 OCR/重 UI 截图保留更多视觉细节。

有关实际分解（每个注入文件、工具、Skills 和系统提示大小），请使用 `/context list` 或 `/context detail`。参见[上下文](/concepts/context)。

## 如何查看当前令牌使用情况

在聊天中使用：

- `/status` → **表情符号丰富的状态卡**，包含会话模型、上下文使用情况、最后响应输入/输出令牌和**估计成本**（仅 API key）。
- `/usage off|tokens|full` → 在每个回复后追加**每响应使用量页脚**。
  - 按会话持久化（存储为 `responseUsage`）。
  - OAuth 认证**隐藏成本**（仅显示令牌）。
- `/usage cost` → 从 CrawClaw 会话日志显示本地成本摘要。

其他表面：

- **Web 客户端：** 支持 `/status` + `/usage`。
- **Desktop 和 Gateway API：** 显示提供商配额窗口（非每响应成本）。

## 成本估算（显示时）

成本从模型定价配置估算：

```
models.providers.<provider>.models[].cost
```

这些是 `input`、`output`、`cacheRead` 和 `cacheWrite` 的**每 1M 令牌 USD**。如果缺少定价，CrawClaw 仅显示令牌。OAuth 令牌永远不显示美元成本。

## 缓存 TTL 和修剪影响

提供商提示缓存仅在缓存 TTL 窗口内适用。CrawClaw 可以选择运行**缓存 TTL 修剪**：一旦缓存 TTL 过期，它会修剪会话，然后重置缓存窗口，使后续请求可以重用新缓存的上下文，而非重新缓存完整历史。当会话在 TTL 后空闲时，这可以保持较低的缓存写入成本。

在 [Gateway 配置](/gateway/configuration) 中配置，行为详情参见[会话修剪](/concepts/session-pruning)。

不要仅为了保持缓存温暖而添加合成唤醒轮次。如果计划检查有真正的产品价值，请使用 cron 作业并慎重调整该作业的模型和会话目标。

在多智能体设置中，你可以保持一个共享模型配置，并使用 `agents.list[].params.cacheRetention` 为每个智能体调整缓存行为。

有关逐个旋钮的指南，请参见[提示缓存](/reference/prompt-caching)。

对于 Anthropic API 定价，缓存读取显著便宜于输入令牌，而缓存写入按更高倍数计费。参见 Anthropic 的提示缓存定价以获取最新费率和 TTL 倍数：
[https://docs.anthropic.com/docs/build-with-claude/prompt-caching](https://docs.anthropic.com/docs/build-with-claude/prompt-caching)

### 示例：长缓存保留

```yaml
agents:
  defaults:
    model:
      primary: "anthropic/claude-opus-4-6"
    models:
      "anthropic/claude-opus-4-6":
        params:
          cacheRetention: "long"
```

### 示例：混合流量，每个智能体缓存策略

```yaml
agents:
  defaults:
    model:
      primary: "anthropic/claude-opus-4-6"
    models:
      "anthropic/claude-opus-4-6":
        params:
          cacheRetention: "long" # 大多数智能体的默认基线
  list:
    - id: "research"
      default: true
      params:
        cacheRetention: "long" # 保持深度会话缓存友好
    - id: "alerts"
      params:
        cacheRetention: "none" # 避免突发通知的缓存写入
```

`agents.list[].params` 在选定模型的 `params` 之上合并，因此你可以仅覆盖 `cacheRetention` 并保持其他模型默认值不变。

### 示例：启用 Anthropic 1M 上下文测试版头

Anthropic 的 1M 上下文窗口当前受测试版限制。当你为支持的 Opus 或 Sonnet 模型启用 `context1m` 时，CrawClaw 可以注入所需的 `anthropic-beta` 值。

```yaml
agents:
  defaults:
    models:
      "anthropic/claude-opus-4-6":
        params:
          context1m: true
```

这映射到 Anthropic 的 `context-1m-2025-08-07` 测试版头。

仅当在该模型条目上设置 `context1m: true` 时适用。

要求：凭证必须符合长上下文使用资格（API key 计费，或启用 Extra Usage 的订阅）。如果不满足，Anthropic 会响应 `HTTP 429: rate_limit_error: Extra usage is required for long context requests`。

如果你使用 OAuth/订阅令牌（`sk-ant-oat-*`）认证 Anthropic，CrawClaw 会跳过 `context-1m-*` 测试版头，因为 Anthropic 当前拒绝该组合并返回 HTTP 401。

## 减少令牌压力的技巧

- 使用 `/compact` 总结长会话。
- 在工作流中精简大型工具输出。
- 对于截图密集型会话，降低 `agents.defaults.imageMaxDimensionPx`。
- 保持 Skills 描述简短（Skills 列表注入到提示中）。
- 对于冗长、探索性的工作，偏好较小的模型。

有关确切的 Skills 列表开销公式，请参见 [Skills](/tools/skills)。
