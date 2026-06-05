---
read_when:
  - 实现或更新 Gateway WS 客户端
  - 调试协议不匹配或连接失败
  - 重新生成协议 schema/模型
summary: Gateway WebSocket 协议：握手、帧、版本控制
title: Gateway 协议
x-i18n:
  generated_at: "2026-06-05T14:30:16Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 738ed7c637a8cdc12b45099bed74f6154fc5c5d5d8118381432f4127fa7cad01
  source_path: gateway/protocol.md
  workflow: 15
---

# Gateway 协议（WebSocket）

Gateway WS 协议是 CrawClaw 的**单一控制平面**。客户端（CLI、浏览器认证客户端和自动化工具）通过 WebSocket 连接，并在握手时声明其**角色**和**作用域**。

## 传输层

- WebSocket，文本帧，JSON 负载。
- 首帧**必须**是 `connect` 请求。

## 握手（connect）

客户端 → Gateway：

```json
{
  "type": "req",
  "id": "…",
  "method": "connect",
  "params": {
    "minProtocol": 3,
    "maxProtocol": 3,
    "client": {
      "id": "cli",
      "version": "1.2.3",
      "platform": "macos",
      "mode": "operator"
    },
    "role": "operator",
    "scopes": ["operator.read", "operator.write"],
    "caps": [],
    "commands": [],
    "permissions": {},
    "auth": { "token": "…" },
    "locale": "en-US",
    "userAgent": "crawclaw-desktop/2026.5.3",
    "device": {
      "id": "device_fingerprint",
      "publicKey": "…",
      "signature": "…",
      "signedAt": 1737264000000,
      "nonce": "…"
    }
  }
}
```

Gateway → 客户端：

```json
{
  "type": "res",
  "id": "…",
  "ok": true,
  "payload": { "type": "hello-ok", "protocol": 3, "policy": { "tickIntervalMs": 15000 } }
}
```

### Node 示例

```json
{
  "type": "req",
  "id": "…",
  "method": "connect",
  "params": {
    "minProtocol": 3,
    "maxProtocol": 3,
    "client": {
      "id": "macos-node",
      "version": "1.2.3",
      "platform": "macos",
      "mode": "node"
    },
    "role": "node",
    "scopes": [],
    "caps": ["camera", "canvas", "screen", "location", "voice"],
    "commands": ["camera.snap", "canvas.navigate", "screen.record", "location.get"],
    "permissions": { "camera.capture": true, "screen.record": false },
    "auth": { "token": "…" },
    "locale": "en-US",
    "userAgent": "crawclaw-macos/1.2.3",
    "device": {
      "id": "device_fingerprint",
      "publicKey": "…",
      "signature": "…",
      "signedAt": 1737264000000,
      "nonce": "…"
    }
  }
}
```

## 帧格式

- **请求**：`{type:"req", id, method, params}`
- **响应**：`{type:"res", id, ok, payload|error}`
- **事件**：`{type:"event", event, payload, seq?, stateVersion?}`

有副作用的方法需要**幂等键**（参见 schema）。

## 记忆方法

记忆运行时方法是 Gateway 控制平面的一部分：

- `memory.status` 返回有效的记忆策略、Hindsight 状态、发件箱摘要和最近的记忆活动。
- `memory.afterTurn` 存储模型可见的轮次增量，并入队记忆回写任务。它接受 `memoryDirective`、`memoryIntent`、`memoryAction` 或 `doNotRemember` 来实现显式的 `remember`、`forget` 和 `do-not-remember` 行为。
- `memory.outbox.list` 列出排队的记忆任务，可按 `status` 过滤。
- `memory.outbox.process` 处理待处理的发件箱任务一次并返回状态计数。这是异步 Hindsight 保留的工作线程入口点。
- `memory.activity.list` 全局或按 `sessionId` 列出最近的记忆活动。

`forget` 任务在本地作为墓碑处理，完成状态为 `completed_local`。墓碑会应用到未来的召回结果中，因此即使远程 Hindsight 后端不暴露删除 API，也会遵守本地删除意图。

## 运行时事件

智能体运行事件由 Rust 运行时发出，由 Gateway 作为协议事件转发。事件负载是序列化的 Rust 事件，当事件属于某个运行时附加了 `runId`。

- `agent.contextProjected`：该轮次使用的提供商上下文投影，包括消息计数、token 估计、折叠状态、投影原因，以及能力降级、工具结果投影、历史压缩和溢出投影的阶段标志。
- `agent.providerBlock`：从 NativeProvider 后端流式传输的提供商文本或元数据块。
- `agent.toolCall`：工具调用开始，包括调用 ID、工具名称和参数。
- `agent.toolProgress`：工具进度或完成状态。
- `agent.toolUseSummary`：工具调用后的紧凑诊断摘要，包括只读分类、持续时间、错误状态、结果投影、忽略的字符数，以及存在时的持久化输出路径。
- `agent.permissionRequested`：工具调用需要权限才能执行。
- `agent.permissionDecision`：权限请求被批准或拒绝，包括模式、类别和原因。
- `agent.hookDecision`：钩子允许、修改或拒绝运行时操作。

## 角色 + 作用域

### 角色

- `operator` = 控制平面客户端（CLI/UI/自动化）。
- `node` = 能力主机（camera/screen/canvas/system.run）。

### 作用域（operator）

常用作用域：

- `operator.read`
- `operator.write`
- `operator.admin`
- `operator.approvals`
- `operator.pairing`

方法作用域只是第一道门槛。通过 `chat.send` 触发的某些斜杠命令会在此基础上应用更严格的命令级检查。例如，持久的 `/config set` 和 `/config unset` 写入需要 `operator.admin`。

## 在线状态

- `system-presence` 在可用时返回按客户端实例键控的条目。
- 在线状态条目包含 `deviceId` 以保持兼容性，加上 `roles` 和 `scopes`，以便 UI 可以为每个客户端实例显示单行。

### 操作员辅助方法

- 操作员可以调用 `tools.catalog`（`operator.read`）来获取智能体的运行时工具目录。响应包含分组的工具和来源元数据：
  - `source`：`core`、`mcp` 或 `native-plugin`
  - `pluginId`：当 `source="native-plugin"` 时为插件所有者
  - `optional`：插件工具是否为可选
- 操作员可以调用 `tools.effective`（`operator.read`）来获取会话的运行时有效工具清单。
  - `sessionKey` 为必需。
  - Gateway 从会话服务器端派生可信运行时上下文，而不是接受调用者提供的认证或传递上下文。
  - 响应是会话范围的，反映当前活动对话可以立即使用的内容，包括 core、plugin 和 channel 工具。
- 操作员可以调用 `mcp_set_servers`（`operator.admin`）并传入 `servers` 对象来替换 CrawClaw 管理的运行时 `mcpServers` 映射。响应遵循 Claude Code 控制形状，包含 `added`、`removed` 和 `errors`。Gateway 运行时快照包含经过清理的 `mcpServers` 摘要，仅包含服务器名称、传输类型、`enabled` 和布尔 `has*` 字段。Claude Code 风格的运行时根目录下的项目 `.mcp.json` 文件也会被读取用于发现和状态；CrawClaw 管理的运行时配置会覆盖匹配的项目服务器名称。
- 操作员可以在桥接 SDK 风格客户端时调用 Claude Code 兼容的控制方法名称：
  - `control_request` 和 `sdk.control_request` 接受 SDK 包装器形状 `{type, request_id, request: {subtype, ...}}`，按 `request.subtype` 分发，并返回 Claude SDK 风格的 `control_response`。以下直接方法名称仍然可用于已解包的调用者。
  - 在正常的 Gateway WebSocket `connect` 握手之后，客户端也可以直接在 socket 上发送原始 Claude SDK 控制帧。`control_request` 帧接收原始 `control_response` 帧，`control_cancel_request` 在可能时取消匹配的在飞任务，`keep_alive` 被忽略，`update_environment_variables` 应用与以下描述相同的运行时环境刷新。
  - `elicitation` 创建待处理的 SDK 征集请求并广播 `sdk.elicitation.requested`，附带提示负载。已连接的操作员客户端可以使用 `elicitation.list` 检查待处理的提示，并使用 `elicitation.respond` 完成一个，参数为 `action="accept"`、`action="decline"` 或 `action="cancel"` 加上可选的对象 `content`。SDK `Elicitation` 钩子可以在提示显示之前返回 `hookSpecificOutput.action` 和 `content`；SDK `ElicitationResult` 钩子可以在返回之前覆盖最终响应。原始 `elicitation` 控制请求等待结果响应并返回 Claude SDK 响应形状；如果在 `timeoutMs`（默认 60 秒）之前没有响应到达，则返回 `{"action":"cancel"}`。
  - `hook_callback` 在附加了实时 SDK 时，通过反向 `control_request` 发送 Claude SDK 风格的响应到实时 SDK WebSocket。没有实时 SDK 控制传输时，它会创建待处理的 SDK 钩子回调请求并广播 `sdk.hookCallback.requested`，附带钩子输入负载。已连接的操作员客户端可以使用 `hook_callback.list` 检查待处理的回调，并使用 `hook_callback.respond` 完成一个，参数为匹配 Claude Code HookJSONOutput 的 `response` 对象。原始 `hook_callback` 控制请求等待该响应；如果在 `timeoutMs`（默认 60 秒）之前没有响应到达，则返回 `{}`。
  - `update_environment_variables` 和 `sdk.update_environment_variables` 接受 `{variables: {"NAME": "value"}}` 并将更新应用到正在运行的 Gateway 进程，以便后续的 provider、MCP 辅助工具和 env 支持的密钥读取能看到刷新的值。响应仅列出更新的变量名。`keep_alive` 和 `sdk.keep_alive` 返回空的成功负载。
  - `initialize` 返回 SDK 会话元数据：命令、智能体、输出样式、模型、账户、进程 ID 和 `fast_mode_state`。通过 `prompts/list` 发现的 MCP 提示作为 SDK 斜杠命令条目暴露，名称为 `mcp__<server>__<prompt>`。在 `initialize` 期间提供的 SDK `agents` 定义在 Gateway 生命周期内保留，并在后续的 `agents`、`reload_plugins` 和 `Agent`/`Task` 解析中可见。在 `initialize` 期间提供的 SDK `systemPrompt` 和 `appendSystemPrompt` 值会被应用到主智能体的系统提示中，用于后续的 Gateway 运行。在 `initialize` 期间提供的 SDK `jsonSchema` 启用了内部 `StructuredOutput` 工具，供后续轮次使用，以便模型可以返回针对请求 schema 验证的结构化输出。在 `initialize` 期间提供的 SDK `hooks` 注册了 Claude Code 风格的回调匹配器，用于支持的 Gateway 轮次事件：`SessionStart`、`SessionEnd`、`Setup`、`ConfigChange`、`Notification`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`PostToolUseFailure` 和 `Stop`，以及 `SubagentStart`/`SubagentStop` 围绕 `Agent`/`Task` 子运行、`PermissionRequest` 在 `can_use_tool` 期间、`PermissionDenied` 在 Gateway 权限拒绝之后、`Elicitation`/`ElicitationResult` 围绕 SDK 征集、`PreCompact`/`PostCompact` 围绕 Gateway 压缩、`StopFailure` 当 Gateway 智能体轮次在完成前失败时。`PreToolUse` 回调在 Rust 工具执行之前运行，可以拒绝调用或用 `hookSpecificOutput.updatedInput` 替换 `tool_input`。`SubagentStart` 回调可以向子运行添加 `hookSpecificOutput.additionalContext`。`PermissionRequest` 回调可以返回 `hookSpecificOutput.decision` 以允许并提供 `updatedInput` 或用消息拒绝。`PermissionDenied` 回调可以返回 `hookSpecificOutput.retry` 以将拒绝标记为可重试。`PostToolUse` 回调在工具执行后立即运行，可以用 `hookSpecificOutput.updatedMCPToolOutput` 替换 MCP 工具输出，然后再将结果返回给模型。`PreToolUse`、`PostToolUse` 和 `PostToolUseFailure` 回调可以返回 `hookSpecificOutput.additionalContext`，作为系统提醒返回给模型，附带相关工具结果。`Setup` 在 `initialize` 期间运行，可以向主智能体提示添加 `hookSpecificOutput.additionalContext`。`ConfigChange` 在 `config.set`、`config.apply` 和 `config.patch` 写入 Gateway 配置文件后运行，附带 `source="local_settings"` 和写入的 `file_path`。`Notification` 为 SDK 面向的提示和失败运行，例如待处理或过期的钩子回调和 MCP 征集。`SessionEnd` 在 `sessions.reset` 清除记录之前运行。在 `initialize` 期间提供的 SDK `sdkMcpServers` 名称作为会话范围的 `type="sdk"` MCP 服务器进行跟踪。当初始化的 SDK WebSocket 保持连接时，这些服务器显示为 `connected`；断开后，它们保持列出但返回 `pending`。
  - `get_settings` 返回 SDK 设置形状：`effective`、有序的 `sources`，以及 `applied` 运行时模型和努力值。
  - `get_context_usage` 返回带有 CrawClaw 会话历史 token 估计的 SDK 上下文使用字段。
  - `set_model`、`set_max_thinking_tokens` 和 `apply_flag_settings` 更新 CrawClaw 运行时控制设置并返回空的成功负载，匹配 Claude Code SDK 控制响应。`set_permission_mode` 返回规范化模式。运行时 `Config` 工具接受相同的 Claude Code 设置键，用于主题、详细程度、记忆、思考、语言、队友、通知和远程控制偏好，并将它们存储在 CrawClaw 运行时配置的 Claude Code 命名空间下。布尔设置接受字符串 `true`/`false` 值，固定选项设置拒绝不支持的值，`remoteControlAtStartup="default"` 取消设置存储的偏好，使运行时回退到其默认值。成功的 `Config` 调用返回 Claude Code 风格的可模型可见的结果文本，如 `theme = "dark"` 或 `Set theme to "dark"`。
  - `mcp_status`、`mcp_reconnect`、`mcp_toggle` 和 `mcp_set_servers` 管理 CrawClaw 管理的 MCP 服务器状态。运行时也从运行时根目录读取项目 `.mcp.json` 服务器定义，以便 Claude Code 项目 MCP 文件参与工具发现、资源读取、提示命令和状态输出。`mcp_toggle` 在 `disabledMcpServers` 和 `enabledMcpServers` 数组中跟踪名称，而服务器定义保持在 `mcpServers` 下。`mcp_status` 返回带有 Claude Code 状态值的 `mcpServers` 条目，如 `connected`、`needs-auth`、`failed`、`pending` 和 `disabled`，以及用于 SDK 可序列化传输的清理过的 `config` 对象（省略 headers 和 env 值）。MCP 配置接受 Claude Code 传输名称，包括 `sse-ide`、`ws-ide` 和 `claudeai-proxy`；可执行支持取决于运行时适配器。HTTP、SSE 和 WebSocket MCP 配置可以使用 Claude Code 风格的 `headersHelper`；CrawClaw 运行辅助工具以在静态 `headers` 上合并动态字符串 headers，而不暴露任一值在状态输出中。报告 `needs-auth` 的 HTTP/SSE 服务器会暴露 `mcp__<server>__authenticate`，使用 Claude Code 的空输入形状；它开始 OAuth URL 生成，并在访问令牌过期时重用存储的刷新令牌。
  - `mcp_reconnect` 重新运行请求服务器的 MCP 发现，仅在服务器达到 `connected` 时返回成功；auth、disabled 和 failed 状态作为控制错误显示。
  - `mcp_message` 将 JSON-RPC 请求和通知转发到 CrawClaw 配置的 MCP 服务器。具有数字 `id` 值的请求返回 `mcp_response`；仅通知消息在传递后返回空成功负载。对于通过 `sdkMcpServers` 注册的 SDK MCP 服务器，Gateway 会发送带有子类型 `mcp_message` 的 Claude SDK `control_request` 回到实时 SDK WebSocket 并等待匹配的 `control_response`。如果该 WebSocket 消失，调用失败而不是假装 SDK 服务器可达。
  - `ListMcpResourcesTool` 在保留 Claude Code 数组结果形状、紧凑 JSON 结果文本和空资源消息的同时，跳过各个 MCP 资源列表失败。`ReadMcpResourceTool` 返回 Claude Code 风格的高层 `contents` 对象作为紧凑 JSON 结果文本，并将二进制 `blob` 资源持久化到运行时工具结果文件，附带 `blobSavedTo`。
  - `crawclaw-runtime mcp-server` 通过 stdio MCP 暴露 Rust 工具池，适用于期望将 Claude Code 风格内部工具作为 MCP 服务器的客户端。它支持 `initialize`、`tools/list`、`tools/call` 以及空的 `resources/list` 和 `prompts/list` 响应。Claude Code 别名暴露 Claude 风格的 `Read`、`Write`、`Edit` 和 `Grep` 描述和 schema；`Write` 和 `Edit` 包括 Claude Code 风格的使用指南，用于写前读、diff、docs 文件、精确缩进和 `replace_all`；`Read`、`Write` 和 `Edit` 使用 Claude Code 风格参数描述和严格高层输入形状，并将 `file_path`、`old_string` 和 `new_string` 翻译到 Rust 工具后端；文本 `Read` 调用记录范围感知的文件新鲜度，并对未更改的重复读取返回 `file_unchanged` 存根，以便对现有文件的 `Write` 和 `Edit` 拒绝缺失或过期的先前读取，同时容忍仅时间戳漂移后的未更改内容；缺失的 `Read`/`Edit` 路径使用 Claude Code 风格的当前工作目录和 "did-you-mean" 指导；`Read` 拒绝 Claude Code 风格的二进制扩展名和阻塞设备文件；并将 PDF 文件和 `pages` 范围路由到 Rust PDF 文本提取；图像读取返回 Claude 风格的 `type="image"` 文件详情和图像块；`Read.offset`/`limit` 接受 Claude Code 语义字符串值，同时拒绝空字符串；文本读取返回 Claude 风格的 `type="text"` 文件详情、大文件大小验证文本、UTF-8 BOM 剥离、尾随换行符行计数和带行号的模型输出；`Write`/`Edit` 返回 Claude 风格的文件结果详情并剥离非 Markdown 尾随行空白，与 Claude Code 一致；`Edit` 在替换文本之前应用 Claude Code 的清理 token 和引号样式匹配规范化；`Edit` 在空文件创建路径之前拒绝相同的 old/new 字符串，在读取之前拒绝超过 1GiB 的目标文件，对缺失或非唯一替换字符串返回 Claude Code 风格文本，并且当 `old_string=""` 时可以创建或填充缺失/空文件；`Edit.replace_all` 接受 Claude Code 精确的 `"true"`/`"false"` 语义布尔字符串；`Glob` 使用 Claude Code 风格参数描述、严格高层输入形状、绝对模式基础目录提取、精确语义数字验证、`rg --files` hidden/no-ignore 默认值、缺失目录当前工作目录和 "did-you-mean" 指导、Claude 风格的 100 结果窗口、按修改时间排序、截断通知、路径验证文本和结构化文件名负载；`Grep` 支持 Claude Code 风格参数描述、严格高层输入形状、`output_mode`、`head_limit`、`offset`、`type`、精确语义数字和布尔验证、带有当前工作目录和 "did-you-mean" 指导的路径验证文本，以及带有相同计数和分页摘要的模型可见结果文本；`WebFetch` 使用 Claude Code 风格认证/私有 URL 指导、严格高层输入形状、使用 Claude Code 风格无效 URL 消息验证 URL 输入、保留 Claude Code 未修剪的纯字符串提示处理、将 `http` 请求升级到 `https`、获取 URL 内容、剥离原生外部内容包装器而不修剪获取的内容、在应用配置的 host model 处理请求的提示之前保留 Claude Code 的截断标记、使用 Claude Code 风格的跨主机重定向阻止并附带重定向说明、在返回 Claude 风格结果负载之前报告 Claude 风格的持续时间和原始 URL 字段；`WebSearch` 接受严格高层输入形状、严格的 Claude 风格 `allowed_domains` 和 `blocked_domains` 过滤器以及查询长度验证，使用 Claude Code 风格来源和当前年份搜索指导，并返回 Claude 风格结果文本以及来源链接提醒和缺失查询及冲突域过滤器的验证文本；`ToolSearch` 暴露 Claude Code 风格严格高层输入形状和参数描述，并使用 Claude 风格 `max_results` 及严格数字验证、大小写不敏感逗号分隔 `select:` 输入、`mcp__server` 前缀搜索、裸工具名称匹配、必需 `+term` 关键字搜索、字符串名称 `matches` 以及带有待处理 MCP 服务器提示的显式无匹配结果文本；`TodoWrite` 暴露 Claude Code 风格描述、严格高层输入形状和结果详情，并被宣传为变更工具；运行时工具目录条目使用 Claude Code 风格别名和延迟工具查找描述；`SendUserMessage`/`Brief` 暴露 Claude Code 风格描述、严格高层输入形状和参数描述，需要 Claude Code 的 `status` 字段；`Agent`/`Task` 暴露 Claude Code 风格描述和参数描述；`ListMcpResourcesTool`/`ReadMcpResourceTool` 暴露 Claude Code 风格描述和严格高层输入形状；`LSP` 使用 Claude Code 风格描述、严格高层输入形状和参数描述；引用、文档/工作区符号以及传入/传出调用层次结构结果使用 Claude 风格空消息、复数计数、按文件分组、符号详情/容器文本和调用站点注解；`TaskCreate`/`TaskGet`/`TaskList`/`TaskUpdate` 暴露 Claude Code 风格描述、严格高层输入形状和参数描述；`TaskGet`/`TaskList`/`TaskUpdate` 返回 Claude Code 风格模型可见任务结果文本；`TaskUpdate` 维护 `addBlocks`/`addBlockedBy` 依赖的两面；`TaskOutput.block` 接受 Claude Code 精确的 `"true"`/`"false"` 语义布尔字符串；`TaskOutput.timeout` 验证 Claude Code 的 0 到 600000 ms 范围；`TaskOutput` 拒绝非 Claude 高层字段；截断的 `TaskOutput` 结果文本使用 Claude Code 的完整输出路径头，而完成的本地智能体任务输出优先于原始记录。`AgentOutputTool`/`BashOutputTool` 别名将 Claude Code 旧版 `agentId`、`bash_id` 和 `wait_up_to` 输入规范化为 `TaskOutput`；`Config` 暴露 Claude Code 风格严格输入形状、参数描述和语义错误结果详情；`Skill` 暴露 Claude Code 风格严格输入形状和参数描述，并被宣传为变更工具；`AskUserQuestion` 暴露 Claude Code 风格严格高层输入形状、参数描述和 HTML 预览验证；`Skill` 返回 Claude Code 内联启动结果文本；`SendMessage`、`Sleep` 和 `StructuredOutput` 暴露 Claude Code 风格描述；`SendMessage` 暴露 Claude Code 风格严格高层输入形状和参数描述，需要纯字符串消息的 `summary`，在回退到独立会话之前从团队清单解析活动团队收件人，将广播范围限定为团队成员而非所有会话，返回紧凑 JSON 结果文本，并且只接受 Claude Code 关闭/计划批准结构化消息；`TeamCreate`/`TeamDelete` 返回紧凑 JSON 结果文本；`TaskList` 像 Claude Code 一样拒绝非空输入；`TeamCreate`/`TeamDelete` 暴露 Claude Code 风格严格参数 schema；`TeamCreate` 使用 Claude Code 风格团队名称清理清单路径，同时在清单和智能体 ID 中保留团队名称；`TeamDelete` 使用 Claude Code 的严格空输入并仅清理活动团队；`TeamCreate` 通过为请求的名称冲突选择唯一名称来保留现有团队清单；团队清单包括 Claude Code 风格的 `agentId`、`joinedAt`、`tmuxPaneId`、`cwd` 和 `subscriptions` 字段；`TeamDelete` 在非负责人团队成员仍活跃时拒绝清理；`TaskStop` 使用 Claude Code 的严格高层输入形状并返回紧凑 JSON 结果文本，包含 Claude Code 风格的缺失 ID、未找到、未运行和描述文本；Bash/PowerShell 暴露 Claude Code 风格描述和参数描述，Bash 指导专用文件/搜索工具、后台运行、命令链接、git 安全性和 sleep 避免，拒绝 Claude Code 风格前台长 `sleep`/`Start-Sleep` 命令，使用 Claude Code 的严格高层输入形状，并接受 Claude Code 语义布尔值用于 `dangerouslyDisableSandbox`；`EnterWorktree`/`ExitWorktree` 暴露 Claude Code 风格描述、严格高层输入形状和参数描述，并返回 Claude 风格可见工作树状态文本。在 `EnterWorktree` 之后，面向工作区的工具（`read`、`write`、`edit`、`apply_patch`、Bash/PowerShell、`grep`、`find`、`ls`、LSP 和 `NotebookEdit`）相对于活动工作区解析路径，而运行时状态工具继续使用运行时根。`ExitWorktree` 在无法证明工作树状态时拒绝删除，除非有明确的丢弃确认。Bash/PowerShell `timeout` 值使用毫秒，验证 Claude Code 的 600000 ms 最大值，Bash `run_in_background` 作为后台运行别名被接受。`Bash` 别名移除冗余的 `cd <cwd> &&` 前缀，并对 `find -exec` 终结符进行转义，与 Claude Code 一致。PowerShell 使用 Claude Code 的非交互式 shell 调用运行，前台 Bash/PowerShell 结果保持 stdout 和 stderr 分离，包括 Claude Code 对 shell 退出代码的非错误解释，如 `grep` 无匹配和 PowerShell `robocopy` 成功范围。Bash/PowerShell 输出在模型看到之前剥离 Claude Code 提示侧通道行，持久化输出包装器使用 Claude Code 的 `BASH_MAX_OUTPUT_LENGTH` 限制、完整输出路径和前 2KB 预览文本。Bash/PowerShell 结果在其结构化详情中包含 Claude Code 兼容的 `stdout`、`stderr`、`interrupted`、后台任务 ID 和持久化输出路径字段，Bash 还报告 `noOutputExpected` 用于静默成功命令，并在调用者提供时保留 `dangerouslyDisableSandbox`。完整图像数据 URI 的前台 shell 输出作为图像内容块返回。它们使用 Claude 风格的后台结果文本指向输出文件路径，将 shell 输出写入运行时工具结果文件，并保持空命令输出为空，而不是生成占位符文本。
  - `reload_plugins` 返回刷新的 `commands`、`agents`、`plugins`、`mcpServers` 和 `error_count`；`commands` 包括项目 markdown 命令以及发现的 MCP 提示命令。项目 markdown 命令从运行时根目录和配置的智能体工作区下的 `.claude/commands/*.md` 和 `.commands/*.md` 读取，使用 Claude Code 风格的 `description`、`argument-hint`、`user-invocable` 和 `hide-from-slash-command-tool` frontmatter。
  - `can_use_tool` 检查运行时工具目录、`tools.allow`、`tools.deny` 和 Claude Code 权限模式，然后返回带有 `behavior="allow"` 或 `behavior="deny"` 的 SDK 权限输出。
  - `Agent` 和旧版 `Task` 被接受为 `subagents_spawn` 的 Claude Code 兼容别名。它们使用 Claude Code 风格严格高层输入形状，包含 `prompt`、`description`、`subagent_type`、`model`、`run_in_background`、`name`、`team_name`、`mode`、`permissionMode` 和 `mcpServers`，然后通过相同的 CrawClaw 子智能体会话运行时运行。`name` 成为 `SendMessage` 查找的生成会话标题，`team_name` 定向现有运行时团队，`mode` 与运行选项一起转发。别名返回 Claude Code 风格异步/完成结果文本，包括后台智能体指令和已完成智能体 `agentId` 加使用量预告。Rust 运行时内置了 `general-purpose`、`Explore`、`Plan` 和 `verification` 的用户可见任务定义；`Explore`、`Plan` 和 `verification` 应用只读权限模式加上读/搜索/MCP 资源工具允许列表，`verification` 需要最终的 `VERDICT` 行。`model: "inherit"` 解析为配置的 provider 模型。当 `subagent_type` 匹配配置的、项目 markdown、desktop、SDK 初始化或内置智能体时，运行会继承该智能体的提示、模型、权限模式、MCP 服务器列表、思考级别和启用工具，除非请求提供显式覆盖。项目 markdown 智能体从 `.claude/agents/*.md` 和 `.agents/*.md` frontmatter 读取，使用 Claude Code 风格的 `name`、`description`、`tools`、`model`、`permissionMode` 和 `mcpServers` 字段，Markdown 正文用作智能体提示。CrawClaw 检查运行时根目录加上配置的智能体工作区，然后让显式配置、desktop 和 SDK 初始化的智能体覆盖匹配的 markdown 智能体。
  - `AskUserQuestion`、`EnterPlanMode` 和 `ExitPlanMode` 暴露 Claude Code 风格工具描述。`EnterPlanMode` 使用 Claude Code 的严格空输入形状。`ExitPlanMode` 暴露 Claude Code 风格参数描述，用 Claude Code 的 `Approved Plan (edited by user)` 结果标题和 `planWasEdited` 输出字段标记主机提供的已编辑计划，`EnterPlanMode` 在工具结果中返回 Claude Code 的只读规划说明。
  - `AskUserQuestion` 在 Claude Code 风格工具结果文本中包含答案注释中的选定预览文本和用户备注。当请求 HTML 预览时，选项预览必须是 HTML 片段：拒绝完整文档和 `<script>` 或 `<style>` 标签，并拒绝纯文本预览并显示 Claude Code 风格的验证消息。
  - `CronCreate` 接受 Claude Code 的精确语义布尔处理用于 `recurring` 和 `durable`，在创建作业之前安全地强制转换字符串 `"true"`/`"false"` 值。它还应用 Claude Code 5 字段 cron 验证、严格高层输入形状和兼容性包装器上的 50 作业上限。`CronCreate`/`CronDelete`/`CronList` 暴露 Claude Code 风格描述；`CronCreate`/`CronDelete`/`CronList` 暴露 Claude Code 风格参数描述；`CronCreate`、`CronDelete` 和 `CronList` 返回收窄的 Claude Code 风格结果形状，包含 `id`、`humanSchedule`、`recurring`、`durable` 和 `jobs` 字段，而非完整的 CrawClaw cron 服务记录。`CronCreate` 在模型可见结果文本中包含持久化元数据和 CrawClaw cron-store 位置，`CronDelete` 拒绝未知作业 ID，`RemoteTrigger` 暴露 Claude Code 风格严格高层输入形状以及 `trigger_id` 和 `body` 参数描述。
  - `RemoteTrigger` 在读取、更新或运行触发器之前使用 Claude Code 的 `^[\w-]+$` 规则验证 `trigger_id`，使用 Claude Code 风格操作特定缺失参数错误，并在 JSON 负载之前返回 Claude Code `HTTP <status>` 结果头。
  - `interrupt` 和 `stop_task` 映射到现有 chat/session 取消界面。使用 `run_in_background` 启动的后台 `Agent`/`Task` 运行保持中止句柄，以便 `stop_task`/`agentRuntime.cancel` 可以停止正在运行的任务，而不仅仅是标记其会话；`cancel_async_message` 还将匹配的异步消息 ID 映射到相同的后台任务取消路径，否则返回 `cancelled=false`。
  - `seed_read_state` 接受 Claude SDK 文件读取种子，在运行时根内解析它们，仅在磁盘上 mtime 未推进时记录 LF 规范化的快照，否则返回 Claude 兼容的空成功负载。`NotebookEdit` 使用与文件编辑相同的原生读取状态边界：笔记本必须在编辑前读取，stale mtime 或更改的内容被拒绝，成功的写入刷新读取状态以进行后续单元格编辑。
  - `rewind_files` 使用匹配智能体轮次之前捕获的内存中文件检查点。检查点覆盖运行时工作树中的 Git 可见常规文件，按 `user_message_id` 键控，并限制以避免快照大型工作树。`dry_run` 报告 `filesChanged`、`insertions` 和 `deletions` 而不写入。非 dry run 恢复更改的检查点文件并移除检查点后创建的 Git 可见文件。如果不存在匹配的检查点，响应保持与 `canRewind=false` 的 SDK schema 兼容。
- 操作员可以调用 `agent.observations.list`（`operator.read`）来获取历史 ObservationContext 运行摘要。
  - 过滤器：`query`、`status`、`source`、`from`、`to`、`limit` 和 `cursor`。
  - `query` 匹配 `runId`、`taskId`、`traceId`、`sessionKey` 和 `agentId`。
  - `from` 和 `to` 是包含性 epoch 毫秒时间边界。
  - 结果仅为元数据，不包含 prompt、transcript 和工具结果体。
- 操作员可以调用 `agent.inspect`（`operator.read`），传入 `runId`、`taskId` 或 `traceId` 来获取所选运行的统一观察时间线。

## 执行审批

- 当执行请求需要审批时，gateway 广播 `exec.approval.requested`。
- 操作员客户端通过调用 `exec.approval.resolve`（需要 `operator.approvals` 作用域）来解决。

## 智能体传递回退

- `agent` 请求可以包含 `deliver=true` 来请求出站传递。
- `bestEffortDeliver=false` 保持严格行为：未解析或仅内部传递目标返回 `INVALID_REQUEST`。
- `bestEffortDeliver=true` 允许在无法解析外部可交付路由时回退到仅会话执行（例如内部会话或模糊的多渠道配置）。

## 版本控制

- `GATEWAY_PROTOCOL_VERSION` 位于 `crates/crawclaw-gateway/src/protocol_contract.rs`。
- 客户端发送 `minProtocol` + `maxProtocol`；服务器拒绝不匹配。
- 打包的 JSON Schema 和协议元数据工件由 Rust Gateway 合约快照发出：
  - `pnpm protocol:gen`
  - `pnpm protocol:check`

## 认证

- 如果设置了 `CRAWCLAW_GATEWAY_TOKEN`（或 `--token`），则 `connect.params.auth.token` 必须匹配，否则 socket 关闭。
- 认证失败包括 `error.details.code` 加上 `error.details.recommendedNextStep`（`update_auth_configuration`、`update_auth_credentials`、`wait_then_retry`、`review_auth_configuration`）。
  - 如果该重试失败，客户端应停止自动重连循环并显示操作员操作指导。

## 设备授权

Gateway 设备授权已被移除。WebSocket 客户端使用配置的 Gateway 认证模式（`token`、`password`、`trusted-proxy` 或显式 `none`）进行认证，不再发送旧版设备负载或等待初步挑战帧。
除设备/客户端/角色/作用域/令牌/随机数字段外。

- 旧版 `v2` 签名仍被接受以保持兼容性，但配对设备元数据固定仍在重新连接时控制命令策略。

## TLS + 固定

- WebSocket 连接支持 TLS。
- 客户端可以选择固定 gateway 证书指纹（参见 `gateway.tls` 配置加 `gateway.remote.tlsFingerprint` 或 CLI `--tls-fingerprint`）。

## 范围

此协议暴露了**完整 gateway API**（状态、渠道、模型、chat、智能体、会话、审批等）。运行时验证器表面仍由 Rust Gateway 实现。生成的 JSON Schema 工件从 Rust Gateway 合约快照发出。
