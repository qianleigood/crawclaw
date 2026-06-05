---
read_when:
  - 你想要注册 Claude Code 兼容的 SDK 生命周期 Hooks
  - 你想要响应 Gateway 生命周期事件或外部 Webhooks
summary: Hooks：Gateway SDK 生命周期回调和外部 Webhooks
title: Hooks
x-i18n:
  generated_at: "2026-06-05T13:50:53Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 1f09b16944199cd8c3edf8129259be8736ac481e0d85288db5199d8b017c95e3
  source_path: automation/hooks.md
  workflow: 15
---

# Hooks

CrawClaw 有两个活跃的 Hook 边界：

- **SDK 生命周期 Hooks**：由 SDK 客户端在 Gateway `initialize` 期间提供的 Claude Code 兼容回调匹配器。这些 Hook 通过实时 SDK 控制传输运行，可以添加上下文、阻止或调整工具调用，以及响应生命周期事件。
- **Webhooks**：外部 HTTP 端点，允许其他系统在 CrawClaw 中触发工作。参见 [Webhooks](/automation/cron-jobs#webhooks)。

较旧的托管或工作区内部 Hook 模块加载器不属于当前 Rust Gateway 运行时。不要将 `HOOK.md` 和 `handler.ts` 文件放在 `~/.crawclaw/hooks` 或 `<workspace>/hooks` 下，期望自动发现。

## SDK 生命周期 Hooks

SDK 生命周期 Hooks 通过在 Gateway SDK `initialize` 请求中发送 `hooks` 来注册。每个条目由 Hook 事件键控，包含带有 `hookCallbackIds` 的回调匹配器。

当匹配的事件触发时，Gateway 会向连接的 SDK 客户端发送 `hook_callback` 控制请求。如果没有连接实时 SDK 控制传输，Gateway 会创建一个待处理的 Hook 回调请求，操作员客户端可以使用 `hook_callback.list` 检查该请求，并使用 `hook_callback.respond` 回答。

完整的控制协议结构，请参见 [Gateway Protocol](/gateway/protocol)。

## 支持的事件

| 事件                 | 触发时机                                                           |
| -------------------- | ------------------------------------------------------------------ |
| `Setup`              | SDK `initialize` 期间                                              |
| `SessionStart`       | 新 Gateway 会话的第一个轮次之前                                    |
| `UserPromptSubmit`   | 提交的用户提示进入智能体运行之前                                   |
| `PreToolUse`         | Rust 工具执行之前立即                                              |
| `PostToolUse`        | 成功的工具调用之后立即                                             |
| `PostToolUseFailure` | 失败的工具调用之后立即                                             |
| `PermissionRequest`  | `can_use_tool` 权限检查期间                                        |
| `PermissionDenied`   | Gateway 权限拒绝之后                                               |
| `Stop`               | 成功的智能体轮次完成之后                                           |
| `StopFailure`        | Gateway 智能体轮次在完成前失败时                                   |
| `SessionEnd`         | 会话重置清除转录状态之前                                           |
| `SubagentStart`      | `Agent` 或 `Task` 子运行启动之前                                   |
| `SubagentStop`       | `Agent` 或 `Task` 子运行停止之后                                   |
| `Notification`       | SDK 面向的提示以及 Hook 回调或请求失败                             |
| `ConfigChange`       | `config.set`、`config.apply` 或 `config.patch` 写入 Gateway 配置后 |
| `Elicitation`        | 显示 SDK MCP 请求提示之前                                          |
| `ElicitationResult`  | 返回 SDK MCP 请求结果之前                                          |
| `PreCompact`         | Gateway 压缩之前                                                   |
| `PostCompact`        | Gateway 压缩之后                                                   |

## Hook 响应

回调返回 Claude Code HookJSONOutput 结构。CrawClaw 目前使用以下字段：

| 字段                                      | 效果                                      |
| ----------------------------------------- | ----------------------------------------- |
| `continue: false`                         | 阻止支持阻止的当前生命周期步骤            |
| `decision: "block"`                       | 使用 `reason` 阻止当前生命周期步骤        |
| `hookSpecificOutput.additionalContext`    | 为支持的事件添加上下文                    |
| `hookSpecificOutput.initialUserMessage`   | 在 `SessionStart` 之前预置初始用户文本    |
| `hookSpecificOutput.updatedInput`         | 替换 `PreToolUse` 的工具输入              |
| `hookSpecificOutput.updatedMCPToolOutput` | 替换 `PostToolUse` 的 MCP 工具输出        |
| `hookSpecificOutput.decision`             | 允许或拒绝 `PermissionRequest`            |
| `hookSpecificOutput.retry`                | 将 `PermissionDenied` 标记为可重试        |
| `hookSpecificOutput.action` 和 `content`  | 覆盖 `Elicitation` 或 `ElicitationResult` |

`PreToolUse`、`PostToolUse` 和 `PostToolUseFailure` 的附加上下文作为系统提醒返回给模型，附加到相关工具结果上。`Setup` 的附加上下文附加到主智能体系统提示中，供后续运行使用。

## 匹配器

Hook 匹配器字符串与事件特定的值进行匹配：

| 事件类型                             | 匹配器输入     |
| ------------------------------------ | -------------- |
| 工具和权限事件                       | 工具名称       |
| `SessionStart`                       | 启动来源       |
| `Setup`                              | 触发器         |
| `PreCompact` 和 `PostCompact`        | 压缩触发器     |
| `Notification`                       | 通知类型       |
| `SessionEnd`                         | 结束原因       |
| `StopFailure`                        | 错误文本       |
| `SubagentStart` 和 `SubagentStop`    | 智能体类型     |
| `ConfigChange`                       | 配置来源       |
| `Elicitation` 和 `ElicitationResult` | MCP 服务器名称 |

空匹配器或 `*` 匹配所有值。简单的 `A|B` 字符串匹配精确值，其他匹配器字符串被视为正则表达式。

## Webhooks

当外部服务应该通过 HTTP 触发 CrawClaw 时使用 Webhooks。Webhook 路由、映射、转换和传递设置位于 `hooks` Gateway 配置键下。参见 [Webhooks](/automation/cron-jobs#webhooks) 和 [Configuration](/gateway/configuration-reference#hooks)。

## 已移除的本地模块加载器

生成的配置引用仍然包含用于兼容性的旧 `hooks.internal.*` 键，但当前 Rust Gateway 运行时不会从托管或工作区 Hook 目录加载本地 TypeScript Hook 模块。

已移除的本地模块加载器使用 `HOOK.md`、`handler.ts`、`hooks.internal.entries` 和 `hooks.internal.load.extraDirs`。这些文件和键不应用于新的自动化。请使用 SDK 生命周期 Hooks 进行 Gateway 生命周期拦截，使用 Webhooks 进行外部触发，或使用 Rust 原生插件功能进行可分发插件行为。

## 故障排除

### SDK Hook 未触发

1. 确认 SDK 客户端在 `initialize` 期间发送了 `hooks`。
2. 确认回调 ID 出现在预期事件的匹配器中。
3. 确认匹配器匹配事件特定的值，例如 `PreToolUse` 的工具名称。
4. 保持 SDK 控制传输连接，或使用 `hook_callback.respond` 响应待处理的回调。

### 外部 Webhook 未触发

检查 `hooks.enabled` 是否设置，请求路径是否匹配 `hooks.mappings` 条目，以及在使用配置令牌时请求是否使用了配置的令牌。

## 相关

- [Gateway Protocol](/gateway/protocol)
- [Webhooks](/automation/cron-jobs#webhooks)
- [Configuration](/gateway/configuration-reference#hooks)
