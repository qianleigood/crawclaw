---
read_when:
  - 解释 token 使用量、成本或上下文窗口时
  - 调试上下文增长或压缩行为时
summary: CrawClaw 如何构建提示上下文并报告 token 使用量 + 成本
title: Token 使用与成本
x-i18n:
  generated_at: "2026-02-03T07:54:57Z"
  model: claude-opus-4-5
  provider: pi
  source_hash: aee417119851db9e36890487517ed9602d214849e412127e7f534ebec5c9e105
  source_path: reference/token-use.md
  workflow: 15
---

# Token 使用与成本

CrawClaw 跟踪的是 **token**，而不是字符。Token 是模型特定的，但大多数
OpenAI 风格的模型对于英文文本平均约 4 个字符为一个 token。

## 系统提示词如何构建

CrawClaw 在每次运行时组装自己的系统提示词。它包括：

- 工具列表 + 简短描述
- Skills 列表（仅元数据；指令通过 `read` 按需加载）
- 自我更新指令
- 工作区引导文件。默认运行时注入刻意保持很窄：普通运行注入
  `AGENTS.md`，仅在旧版 heartbeat 兼容路径中保留 `HEARTBEAT.md`。
  其他工作区文件（如 `SOUL.md`、`TOOLS.md`、`IDENTITY.md`、`USER.md`、
  `BOOTSTRAP.md` 和 `MEMORY.md`）仍可由工具、工作流或显式 extra-bootstrap
  hook 使用，但不属于默认 bootstrap surface。大文件会被
  `agents.defaults.bootstrapMaxChars`（默认：20000）截断，总 bootstrap
  注入量受 `agents.defaults.bootstrapTotalMaxChars`（默认：150000）限制。
  `memory/*.md` 文件保持按需加载，不会自动注入。
- 时间（UTC + 用户时区）
- 回复标签 + 事件驱动的主会话唤醒行为
- 运行时元数据（主机/操作系统/模型/思考）

完整分解参见[系统提示词](/concepts/system-prompt)。

## 什么算入上下文窗口

模型接收的所有内容都计入上下文限制：

- 系统提示词（上面列出的所有部分）
- 对话历史（用户 + 助手消息）
- 工具调用和工具结果
- 附件/转录（图片、音频、文件）
- 压缩摘要和修剪产物
- 提供商包装或安全头（不可见，但仍计数）

有关实际分解（每个注入文件、工具、Skills 和系统提示词大小），使用 `/context list` 或 `/context detail`。参见[上下文](/concepts/context)。

## 如何查看当前 token 使用量

在聊天中使用：

- `/status` → 带有会话模型、上下文使用量、
  最后响应输入/输出 token 和**预估成本**（仅 API 密钥）的 **emoji 丰富的状态卡片**。
- `/usage off|tokens|full` → 在每个回复后附加**每响应使用量页脚**。
  - 每会话持久化（存储为 `responseUsage`）。
  - OAuth 认证**隐藏成本**（仅 token）。
- `/usage cost` → 从 CrawClaw 会话日志显示本地成本摘要。

其他界面：

- **TUI/Web TUI：** 支持 `/status` + `/usage`。
- **CLI：** `crawclaw status --usage` 和 `crawclaw channels list` 显示
  提供商配额窗口（不是每响应成本）。

## 成本估算（显示时）

成本从你的模型定价配置估算：

```
models.providers.<provider>.models[].cost
```

这些是 `input`、`output`、`cacheRead` 和
`cacheWrite` 的**每 1M token 美元**。如果缺少定价，CrawClaw 仅显示 token。OAuth 令牌
永远不显示美元成本。

## 缓存 TTL 和修剪影响

提供商提示缓存仅在缓存 TTL 窗口内适用。CrawClaw 可以
选择性地运行**缓存 TTL 修剪**：它在缓存 TTL
过期后修剪会话，然后重置缓存窗口，以便后续请求可以重用
新缓存的上下文，而不是重新缓存完整历史。这在会话空闲超过 TTL 时
可以降低缓存写入成本。

在 [Gateway 网关配置](/gateway/configuration) 中配置它，并在
[会话修剪](/concepts/session-pruning) 中查看行为详情。

不要只为了保持缓存热而添加合成唤醒轮次。如果计划检查有真实产品价值，请使用 cron job，并有意设置该 job 的模型和 session target。

在多智能体配置中，你可以保留一套共享模型配置，并通过 `agents.list[].params.cacheRetention` 按智能体调节缓存行为。

完整逐项配置指南见[提示缓存](/reference/prompt-caching)。

有关 Anthropic API 定价，缓存读取比输入
token 便宜得多，而缓存写入以更高的倍率计费。参见 Anthropic 的
提示缓存定价了解最新费率和 TTL 倍率：
[https://docs.anthropic.com/docs/build-with-claude/prompt-caching](https://docs.anthropic.com/docs/build-with-claude/prompt-caching)

### 示例：长缓存保留

```yaml
agents:
  defaults:
    model:
      primary: "anthropic/claude-opus-4-5"
    models:
      "anthropic/claude-opus-4-5":
        params:
          cacheRetention: "long"
```

## 减少 token 压力的技巧

- 使用 `/compact` 来总结长会话。
- 在你的工作流中修剪大的工具输出。
- 保持 skill 描述简短（skill 列表会注入到提示中）。
- 对于冗长的探索性工作，优先使用较小的模型。

精确的 skill 列表开销公式参见 [Skills](/tools/skills)。
