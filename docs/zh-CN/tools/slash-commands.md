---
read_when:
  - 使用或配置聊天命令
  - 调试命令路由或权限
summary: 斜杠命令：文本 vs 原生、配置和支持的命令
title: 斜杠命令
x-i18n:
  generated_at: "2026-02-03T10:12:40Z"
  model: claude-opus-4-5
  provider: pi
  source_hash: 60984cbbaa30683579f6e0ca634689e38acc0b27782b266fc39ae8cfbbfa64d0
  source_path: tools/slash-commands.md
  workflow: 15
---

# 斜杠命令

命令由 Gateway 网关处理。大多数命令必须作为以 `/` 开头的**独立**消息发送。
仅主机的 bash 聊天命令使用 `! <cmd>`（`/bash <cmd>` 是别名）。

有两个相关系统：

- **命令**：独立的 `/...` 消息。
- **指令**：`/think`、`/fast`、`/verbose`、`/reasoning`、`/elevated`、`/exec`、`/model`、`/queue`。
  - 指令在模型看到消息之前被剥离。
  - 在普通聊天消息中（不是仅指令消息），它们被视为"内联提示"，**不会**持久化会话设置。
  - 在仅指令消息中（消息只包含指令），它们会持久化到会话并回复确认。
  - 指令仅对**授权发送者**生效。如果配置了 `commands.allowFrom`，它会成为唯一授权来源；否则授权来自渠道白名单/配对以及 `commands.useAccessGroups`。
  - 未授权发送者的指令会被视为纯文本。

还有一些**内联快捷方式**（仅限白名单/授权发送者）：`/help`、`/commands`、`/status`、`/whoami`（`/id`）。
它们立即运行，在模型看到消息之前被剥离，剩余文本继续通过正常流程。

## 配置

```json5
{
  commands: {
    native: "auto",
    nativeSkills: "auto",
    text: true,
    bash: false,
    bashForegroundMs: 2000,
    config: false,
    mcp: false,
    plugins: false,
    debug: false,
    restart: true, // 默认启用；设为 false 可禁用手动重启
    allowFrom: {
      "*": ["user1"],
      qqbot: ["user:123"],
    },
    useAccessGroups: true,
  },
}
```

- `commands.text`（默认 `true`）启用解析聊天消息中的 `/...`。
  - 在没有原生命令的平台上（Weixin/Gateway 客户端/Feishu/Weixin/Feishu/MS Teams），即使你将此设置为 `false`，文本命令仍然有效。
- `commands.native`（默认 `"auto"`）注册原生命令。
  - Auto：在 QQBot/Feishu 上启用；在 DingTalk 上禁用（直到你添加斜杠命令）；在不支持原生命令的提供商上忽略。
  - 设置 `channels.qqbot.commands.native`、`channels.feishu.commands.native` 或 `channels.ddingtalk.commands.native` 以按提供商覆盖（布尔值或 `"auto"`）。
  - `false` 在启动时清除 QQBot/Feishu 上之前注册的命令。DingTalk 命令在 DingTalk 应用中管理，不会自动删除。
- `commands.nativeSkills`（默认 `"auto"`）在支持时原生注册 **Skill** 命令。
  - Auto：在 QQBot/Feishu 上启用；在 DingTalk 上禁用（DingTalk 需要为每个 Skill 创建一个斜杠命令）。
  - 设置 `channels.qqbot.commands.nativeSkills`、`channels.feishu.commands.nativeSkills` 或 `channels.ddingtalk.commands.nativeSkills` 以按提供商覆盖（布尔值或 `"auto"`）。
- `commands.bash`（默认 `false`）启用 `! <cmd>` 来运行主机 shell 命令（`/bash <cmd>` 是别名；需要 `tools.elevated` 白名单）。
- `commands.bashForegroundMs`（默认 `2000`）控制 bash 切换到后台模式之前等待多长时间（`0` 立即后台运行）。
- `commands.config`（默认 `false`）启用 `/config`（读写 `crawclaw.json`）。
- `commands.mcp`（默认 `false`）启用 `/mcp`（读写 CrawClaw 管理的 MCP 配置，位于 `mcpServers`）。
- `commands.plugins`（默认 `false`）启用 `/plugins`（插件发现/状态和安装/启停控制）。
- `commands.debug`（默认 `false`）启用 `/debug`（仅运行时覆盖）。
- `commands.allowFrom`（可选）按 provider 指定命令授权白名单。配置后，它会成为命令/指令的唯一授权来源。
- `commands.useAccessGroups`（默认 `true`）在未配置 `commands.allowFrom` 时，对命令强制执行白名单/策略。

## 命令列表

文本 + 原生（启用时）：

- `/help`
- `/commands`
- `/tools [compact|verbose]`（显示当前 agent 此刻能用的 runtime tools）

只读查询命令：

- `/health`（Gateway、sessions 和已配置 channel 摘要）
- `/channels`（来自 `/health` 同一健康快照的 channel-only 详情视图）
- `/sessions`（只读的已存储 session 列表；`/session` 会更改当前聊天设置）
- `/devices`（聊天/移动设备配对摘要）
- `/memory`（memory provider 访问状态；`/context` 解释提示词输入）
- `/skills`（列出用户可调用的 skill slash commands；`/skill` 会运行一个 skill）

操作和 session 命令：

- `/skill <name> [input]`（按名称运行 Skill）
- `/status`（显示当前状态；在可用时包含当前模型提供商的提供商使用量/配额）
- `/tasks`（列出当前会话的后台任务；显示 active 和 recent 任务详情，并包含 agent-local fallback 计数）
- `/allowlist`（列出/添加/删除白名单条目）
- `/approve <id> <decision>`（解决 exec 审批提示；可用 decision 以待处理审批消息为准）
- `/context [list|detail|json]`（解释"上下文"；`detail` 显示每个文件 + 每个工具 + 每个 Skill + 系统提示词大小）
- `/btw <question>`（针对当前会话发起一个不改变后续上下文的临时侧问；参见 [/tools/btw](/tools/btw)）
- `/export-session [path]`（别名：`/export`，导出当前会话 HTML，并包含完整系统提示词）
- `/whoami`（显示你的发送者 ID；别名：`/id`）
- `/review [focus]`（为当前任务运行两阶段 review pipeline，可选指定 review focus）
- `/session idle <duration|off>`（管理 focused thread binding 的闲置超时）
- `/session max-age <duration|off>`（管理 focused thread binding 的最大存活时间）
- `/subagents list|kill|log|info|send|steer|spawn`（检查、控制或创建当前会话的子智能体运行）
- `/acp spawn|cancel|steer|close|status|set-mode|set|cwd|permissions|timeout|model|reset-options|doctor|install|sessions`（检查和控制 ACP 运行时）
- `/agents`（列出当前会话的 thread-bound agents）
- `/focus <target>`（绑定当前线程或新线程到某个 session/subagent）
- `/unfocus`（移除当前线程绑定）
- `/kill <id|#|all>`（立即终止一个或全部子智能体）
- `/steer <id|#> <message>`（立即引导正在运行的子智能体）
- `/tell <id|#> <message>`（`/steer` 的别名）
- `/config show|get|set|unset`（将配置持久化到磁盘，仅所有者；需要 `commands.config: true`）
- `/mcp show|get|set|unset`（管理 CrawClaw MCP 配置，仅所有者；需要 `commands.mcp: true`）
- `/plugins list|show|get|install|enable|disable`（检查、安装、启停插件；写操作仅所有者；需要 `commands.plugins: true`）
  - `/plugin` 是 `/plugins` 的别名。
  - `/plugin install <spec>` 接受与 CrawClaw Desktop 或本地 Gateway API 相同的 plugin spec：本地路径/归档、npm package 或 `clawhub:<pkg>`。
  - Enable/disable 写入仍会回复重启提示。在 watched foreground gateway 上，CrawClaw 可能会在写入后自动执行该重启。
- `/debug show|set|unset|reset`（运行时覆盖，仅所有者；需要 `commands.debug: true`）
- `/usage off|tokens|full|cost`（每响应使用量页脚或本地成本摘要）
- `/tts off|always|inbound|tagged|status|provider|limit|summary|audio`（控制 TTS；参见 [/tools/tts](/tools/tts)）
  - QQBot：原生命令是 `/voice`（QQBot 保留了 `/tts`）；文本 `/tts` 仍然有效。
- `/stop`
- `/restart`
- `/dock-feishu`（别名：`/dock_feishu`）（将回复切换到 Feishu）
- `/dock-qqbot`（别名：`/dock_qqbot`）（将回复切换到 QQBot）
- `/dock-ddingtalk`（别名：`/dock_ddingtalk`）（将回复切换到 DingTalk）
- `/activation mention|always`（仅限群组）
- `/send on|off|inherit`（仅所有者）
- `/new [model]`（可选模型提示；其余部分传递）
- `/think <off|minimal|low|medium|high|xhigh>`（按模型/提供商动态选择；别名：`/thinking`、`/t`）
- `/fast status|on|off`（省略参数时显示当前 fast-mode 状态）
- `/verbose on|full|off`（别名：`/v`）
- `/reasoning on|off|stream`（别名：`/reason`；启用时，发送带有 `Reasoning:` 前缀的单独消息；`stream` = 仅 Feishu 草稿）
- `/elevated on|off|ask|full`（别名：`/elev`；`full` 跳过 exec 审批）
- `/model <name>`（别名：`/models`；或 `agents.defaults.models.*.alias` 中的 `/<alias>`）
- `/queue <mode>`（加上选项如 `debounce:2s cap:25 drop:summarize`；发送 `/queue` 查看当前设置）
- `/bash <command>`（仅主机；`! <command>` 的别名；需要 `commands.bash: true` + `tools.elevated` 白名单）

仅文本：

- `/compact [instructions]`（参见 [/concepts/compaction](/concepts/compaction)）
- `! <command>`（仅主机；一次一个；对长时间运行的任务使用 `!poll` + `!stop`）
- `!poll`（检查输出/状态；接受可选的 `sessionId`；`/bash poll` 也可用）
- `!stop`（停止正在运行的 bash 任务；接受可选的 `sessionId`；`/bash stop` 也可用）

注意事项：

- 命令接受命令和参数之间的可选 `:`（例如 `/think: high`、`/send: on`、`/help:`）。
- `/new <model>` 接受模型别名、`provider/model` 或提供商名称（模糊匹配）；如果没有匹配，文本被视为消息正文。
- `/review` 会通过 task-backed special agents 运行两阶段 review pipeline。
  - 不带参数时，它会 review 当前任务结果、最近的工作区改动和当前会话的用户可见行为。
  - 带参数时，后面的文本会成为 review focus，例如：`/review check plugin SDK boundary coverage`。
  - review 会话按策略是只读的：只保留验证类工具，并且不能递归再次启动 review。
  - `/review` 是唯一的用户可见 review 入口；内部 `review_task` tool flow 不作为公开 slash command 暴露。
- 要获取完整的提供商使用量分解，请使用 CrawClaw Desktop 或本地 Gateway API。
- `/allowlist add|remove` 需要 `commands.config=true` 并遵循渠道 `configWrites`。
- 在多账号 channel 中，面向配置的 `/allowlist --account <id>` 和 `/config set channels.<provider>.accounts.<id>...` 也遵循目标账号的 `configWrites`。
- `/usage` 控制每响应使用量页脚；`/usage cost` 从 CrawClaw 会话日志打印本地成本摘要。
- `/restart` 默认启用；设置 `commands.restart: false` 可禁用。
- QQBot-only 原生命令：`/vc join|leave|status` 控制语音频道（需要 `channels.qqbot.voice` 和原生命令；不作为文本命令提供）。
- QQBot thread-binding 命令（`/focus`、`/unfocus`、`/agents`、`/session idle`、`/session max-age`）需要启用有效 thread binding（`session.threadBindings.enabled` 和/或 `channels.qqbot.threadBindings.enabled`）。
- ACP 命令参考和运行时行为：[ACP Agents](/tools/acp-agents)。
- `/verbose` 用于调试和额外可见性；在正常使用中保持**关闭**。
- `/fast on|off` 会持久化 session override。使用 Sessions UI 的 `inherit` 选项可以清除它，并回退到 config 默认值。
- `/fast` 是 provider-specific：OpenAI/OpenAI Codex 在 native Responses endpoint 上映射为 `service_tier=priority`，而直连 public Anthropic 请求（包括发往 `api.anthropic.com` 的 OAuth 认证流量）映射为 `service_tier=auto` 或 `standard_only`。参见 [OpenAI](/providers/openai) 和 [Anthropic](/providers/anthropic)。
- 相关时仍会显示 tool failure summary，但详细失败文本只有在 `/verbose` 为 `on` 或 `full` 时才会包含。
- `/reasoning`（和 `/verbose`）在群组设置中有风险：它们可能会暴露你不打算公开的内部推理或工具输出。最好保持关闭，尤其是在群聊中。
- `/model` 会立即持久化新的 session model，但不会中断正在执行的 run。当前 turn 会先完成，之后排队或未来工作才使用更新后的 model。
- **快速路径：** 来自白名单发送者的仅命令消息会立即处理（绕过队列 + 模型）。
- **群组提及门控：** 来自白名单发送者的仅命令消息绕过提及要求。
- **内联快捷方式（仅限白名单发送者）：** 某些命令在嵌入普通消息时也能工作，并在模型看到剩余文本之前被剥离。
  - 示例：`hey /status` 触发状态回复，剩余文本继续通过正常流程。
- 目前：`/help`、`/commands`、`/status`、`/whoami`（`/id`）。
- 未授权的仅命令消息被静默忽略，内联 `/...` 令牌被视为纯文本。
- **Skill 命令：** `user-invocable` Skills 作为斜杠命令公开。名称被清理为 `a-z0-9_`（最多 32 个字符）；冲突获得数字后缀（例如 `_2`）。
  - `/skill <name> [input]` 按名称运行 Skill（当原生命令限制阻止每个 Skill 命令时有用）。
  - 默认情况下，Skill 命令作为普通请求转发给模型。
  - Skills 可以选择声明 `command-dispatch: tool` 将命令直接路由到工具（确定性，无模型）。
  - 示例：`/prose`（OpenProse 插件）— 参见 [OpenProse](/prose)。
- **原生命令参数：** QQBot 使用自动完成进行动态选项（以及当你省略必需参数时的按钮菜单）。当命令支持选择且你省略参数时，Feishu 和 DingTalk 显示按钮菜单。
- **本地化命令外壳：** command name 和 argument value 保持英文，但 command description、argument hint、choice label、help text、usage prompt 和 native-command menu 会跟随 `cli.language`（例如 `zh-CN`）。

## `/tools`

`/tools` 回答的是运行时问题，不是配置问题：**这个 agent 在当前对话里现在能用什么工具**。

- 默认 `/tools` 是 compact 模式，适合快速扫描。
- `/tools verbose` 会附带简短描述。
- 支持参数的原生命令面也暴露同一个 `compact|verbose` 模式切换。
- 结果是 session-scoped，因此 agent、channel、thread、sender authorization 或 model 改变后，输出也可能改变。
- `/tools` 包含运行时实际可达的工具，包括 core tools、已连接 plugin tools 和 channel-owned tools。

编辑 profile 和 override 时，应使用 config/catalog surface，不要把 `/tools` 当成静态 catalog。

## `/review`

`/review` 是内部两阶段 review flow 的聊天命令包装层。它会启动独立的 spec-compliance 和 code-quality review agents，等待它们的报告，应用确定性聚合器，然后把简短结果返回到当前对话。

示例：

```text
/review
/review check plugin SDK boundaries
/review check that the refactor covers all built-in and plugin channels
```

行为：

- spec reviewer 和 quality reviewer 拿到的是专用 review prompt，而不是完整父 transcript。
- 每个 reviewer 都必须输出严格的 `STAGE`、`VERDICT`、`SUMMARY`、`BLOCKING_ISSUES`、`WARNINGS`、`EVIDENCE` 和 `RECOMMENDED_FIXES` 结构。
- 最终 verdict 是 `REVIEW_PASS`、`REVIEW_FAIL` 或 `REVIEW_PARTIAL`。
- 只有 `REVIEW_PASS` 可以作为父任务的 review completion evidence。
- review 会话不能再次创建嵌套 review 会话。
- `/review` 是唯一公开的 review 入口。

## 使用量显示（什么显示在哪里）

- **提供商使用量/配额**（示例："Claude 80% left"）在启用使用量跟踪时显示在 `/status` 中，针对当前模型提供商。
- **每响应令牌/成本**由 `/usage off|tokens|full` 控制（附加到普通回复）。
- `/model status` 是关于**模型/认证/端点**的，不是使用量。

## 模型选择（`/model`）

`/model` 作为指令实现。

示例：

```
/model
/model list
/model 3
/model openai/gpt-5.2
/model opus@anthropic:default
/model status
```

注意事项：

- `/model` 和 `/model list` 显示紧凑的编号选择器（模型系列 + 可用提供商）。
- 在 QQBot 上，`/model` 和 `/models` 会打开带 provider/model 下拉框和 Submit 步骤的交互式选择器。
- `/model <#>` 从该选择器中选择（并在可能时优先选择当前提供商）。
- `/model status` 显示详细视图，包括在可用时配置的提供商端点（`baseUrl`）和 API 模式（`api`）。

## 调试覆盖

`/debug` 让你设置**仅运行时**的配置覆盖（内存，不写磁盘）。仅所有者。默认禁用；使用 `commands.debug: true` 启用。

示例：

```
/debug show
/debug set messages.responsePrefix="[crawclaw]"
/debug set channels.weixin.allowFrom=["+1555","+4477"]
/debug unset messages.responsePrefix
/debug reset
```

注意事项：

- 覆盖立即应用于新的配置读取，但**不会**写入 `crawclaw.json`。
- 使用 `/debug reset` 清除所有覆盖并返回到磁盘上的配置。

## 配置更新

`/config` 写入你的磁盘配置（`crawclaw.json`）。仅所有者。默认禁用；使用 `commands.config: true` 启用。

示例：

```
/config show
/config show messages.responsePrefix
/config get messages.responsePrefix
/config set messages.responsePrefix="[crawclaw]"
/config unset messages.responsePrefix
```

注意事项：

- 配置在写入前会验证；无效更改会被拒绝。
- `/config` 更新在重启后持久化。

## MCP 更新

`/mcp` 将 CrawClaw 管理的 MCP server definitions 写入 runtime `mcpServers` map。仅所有者。默认禁用；使用 `commands.mcp: true` 启用。

示例：

```text
/mcp show
/mcp show context7
/mcp set context7={"command":"uvx","args":["context7-mcp"]}
/mcp unset context7
```

注意事项：

- `/mcp` 将 MCP server definitions 存在 CrawClaw runtime config 中，因此 Gateway `mcp_set_servers`、`mcp_status`、`mcp_toggle`、tool discovery 和 resource reads 都使用同一个 `mcpServers` map。runtime 也会从 runtime root 读取 Claude Code 风格的项目 `.mcp.json` 用于 discovery/status；匹配 server name 时，CrawClaw 管理的 runtime config 优先。
- `mcp_set_servers` 会报告 `added`、`removed` 和 `errors`；`mcp_status` 会报告 Claude Code 风格状态值，以及适用于 SDK-serializable transports 的清理后 `config` 对象，不暴露 headers 或 env 值。Status discovery 覆盖 MCP tools、prompts 和 resources。`mcp_reconnect` 会重新运行 discovery，并且只有 server connected 后才成功。`mcp_message` 将 JSON-RPC requests 和 notifications 转发到已配置 MCP servers；numeric-id requests 返回 `mcp_response`。MCP resource list/read tools 为 SDK clients 保留 Claude Code 风格 result shape。
- Disabled MCP server names 会记录在 Claude Code 风格的 `disabledMcpServers`/`enabledMcpServers` arrays 中。Server definitions 仍保留在 `mcpServers`，但 disabled 时会从 tool discovery 和 resource reads 中省略。
- Runtime adapters 接受 Claude Code MCP transport names，包括 `stdio`、`http`、`sse`、`sse-ide`、`ws`、`ws-ide`、`sdk` 和 `claudeai-proxy`；可执行 transport support 仍取决于 runtime adapter。
- HTTP、SSE 和 WebSocket MCP entries 可以使用 Claude Code 风格的 `headersHelper` 生成动态 string headers。Helper values 会覆盖 static `headers`，status output 只报告是否存在 headers。
- 返回 `needs-auth` 的 HTTP 和 SSE MCP servers 会暴露 Claude Code 风格的 `mcp__<server>__authenticate` pseudo tool。它先返回 OAuth authorization URL，然后接受 callback URL 或 `code` + `state` 来存储 token 供后续 MCP requests 使用。Access token 过期时会复用 stored refresh token。
- 通过 `prompts/list` 发现的 MCP prompts 会向 Claude Code-compatible SDK clients 暴露为名为 `mcp__<server>__<prompt>` 的 slash commands。
- `.claude/commands/*.md` 和 `.commands/*.md` 中的 project markdown commands 会在 `initialize` 和 `reload_plugins` 期间暴露给 Claude Code-compatible SDK clients。CrawClaw 会从 runtime root 和已配置 agent workspaces 读取它们，并使用 Claude Code 风格 frontmatter：`description`、`argument-hint`、`user-invocable` 和 `hide-from-slash-command-tool`。

## Agent tool aliases

对于 Claude Code-compatible SDK clients，Gateway 接受 wrapped `control_request` shape 并按 `request.subtype` 分发；调用方也可以直接调用 subtype method names。Gateway WebSocket `connect` 握手后，clients 也可以在 socket 上发送 raw SDK `control_request`、`control_cancel_request`、`keep_alive` 和 `update_environment_variables` frames。SDK `hook_callback` 在 live SDK WebSocket 可用时使用它作为 reverse `control_request` transport；否则会创建 pending Gateway prompt，广播 `sdk.hookCallback.requested`，并等待 `hook_callback.respond`。SDK `elicitation` 可以先由 SDK `Elicitation` hooks 响应；否则会创建 pending Gateway prompt，广播 `sdk.elicitation.requested`，并等待 `elicitation.respond`。SDK `ElicitationResult` hooks 可以在返回 response 前覆盖 final action/content。Hook callbacks 和 elicitations 都返回 Claude SDK response shape；无人响应时分别超时为 `{}` 或 `cancel`。`update_environment_variables` 将 SDK environment refresh 应用到运行中的 Gateway process，使后续 provider、MCP helper 和 env-backed secret reads 能看到新值，同时不在 response 中暴露 secret values。SDK `rewind_files` 使用 agent turns 前捕获的 bounded in-memory checkpoints，覆盖 runtime worktree 中 Git-visible regular files；`dry_run` 报告 changed files 和 line deltas，非 dry run 会恢复 checkpointed files，并删除 checkpoint 后创建的 Git-visible files。`initialize` 期间提供的 SDK `hooks` 会为支持的 Gateway turn events 注册 Claude Code 风格 callback matchers：`SessionStart`、`SessionEnd`、`Setup`、`ConfigChange`、`Notification`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`PostToolUseFailure`、`Stop`、`StopFailure`、`SubagentStart`、`SubagentStop`、`PermissionRequest`、`PermissionDenied`、`Elicitation`、`ElicitationResult`、`PreCompact` 和 `PostCompact`。`Setup` 在 `initialize` 期间运行，并可将 `hookSpecificOutput.additionalContext` 加入 main agent prompt。`ConfigChange` 在 `config.set`、`config.apply` 和 `config.patch` 写 Gateway config file 后运行，带有 `source="local_settings"` 和写入的 `file_path`。`Notification` 针对 SDK-facing prompts 和 failures 运行，例如 pending 或 expired hook callbacks 和 MCP elicitations。`SessionEnd` 在 `sessions.reset` 清空 transcript 前运行。`StopFailure` 在 Gateway agent turn 完成前失败时运行。`SubagentStart` 可以将 `hookSpecificOutput.additionalContext` 加入 child run，`SubagentStop` 会收到 child transcript path 和 final assistant text。`PreToolUse` callbacks 在 Rust tool execution 前运行，可 deny call 或用 `hookSpecificOutput.updatedInput` 替换 `tool_input`。`PermissionRequest` callbacks 在 `can_use_tool` 期间运行，可返回 `hookSpecificOutput.decision` 以 allow（带 updatedInput）或 deny（带 message）。`PermissionDenied` callbacks 在 Gateway permission denials 后运行，可返回 `hookSpecificOutput.retry` 将 denial 标记为 retryable。`PreCompact` 和 `PostCompact` 包围 Gateway compaction。`initialize` 期间提供的 SDK `sdkMcpServers` names 会被跟踪为 session-scoped `type="sdk"` MCP servers；只要该 SDK WebSocket 保持 connected，`mcp_message` 就会作为 Claude SDK `control_request` 转发回它，并等待匹配的 `control_response`。`Agent` 和 legacy `Task` 是 `subagents_spawn` 的 aliases。Aliases 接受 `prompt`、`description`、`subagent_type`、`model`、`run_in_background`、`allowedTools`/`enabledTools` 和 `systemPrompt`，然后走同一个 CrawClaw sub-agent session runtime。当 `subagent_type` 匹配 configured、project markdown、desktop 或 SDK-initialized agent 时，除非请求显式覆盖，否则 run 会继承该 agent 的 prompt、model、thinking level 和 enabled tools。Project markdown agents 从 `.claude/agents/*.md` 和 `.agents/*.md` frontmatter 读取 Claude Code 风格字段：`name`、`description`、`tools`、`model`、`permissionMode` 和 `mcpServers`，Markdown body 作为 agent prompt。`initialize` 期间提供的 SDK `agents` definitions 会在 Gateway lifetime 内保留，并在后续 `agents`、`reload_plugins` 和 `Agent`/`Task` resolution 中可见。`initialize` 期间提供的 SDK `systemPrompt` 和 `appendSystemPrompt` 会应用到 main agent 后续 Gateway runs 的 system prompt。`initialize` 期间提供的 SDK `jsonSchema` 会启用内部 `StructuredOutput` tool，让后续 turns 中的模型可以返回符合请求 schema 的 structured output。SDK `seed_read_state` 在文件未改变时记录 LF-normalized file-read seeds；stale 或 missing files 返回 Claude-compatible empty success。CrawClaw 会检查 runtime root 和 configured agent workspaces，然后让 explicit config、desktop 和 SDK-initialized agents 覆盖匹配的 markdown agents。用 `run_in_background` 启动的 background runs 可通过 `stop_task`、`agentRuntime.cancel` 或匹配的 `cancel_async_message` 停止。`allowedTools`/`enabledTools` 接受 exact names 以及 `*`、`prefix*`、`mcp__server__*` rule forms。

## Plugin 更新

`/plugins` 允许 operator 检查已发现插件，并在 config 中切换 enablement。只读流程可以使用 `/plugin` 作为别名。默认禁用；使用 `commands.plugins: true` 启用。

示例：

```text
/plugins
/plugins list
/plugin show context7
/plugins enable context7
/plugins disable context7
```

注意事项：

- `/plugins list` 和 `/plugins show` 会基于当前 workspace 和磁盘 config 运行真实 plugin discovery。
- `/plugins enable|disable` 只更新 plugin config；它不会安装或卸载 plugins。
- enable/disable 更改后，重启 gateway 以应用它们。

## 平台注意事项

- **文本命令**在普通聊天会话中运行（私信共享 `main`，群组有自己的会话）。
- **原生命令**使用隔离的会话：
  - QQBot：`agent:<agentId>:qqbot:slash:<userId>`
  - DingTalk：`agent:<agentId>:ddingtalk:slash:<userId>`（前缀可通过 `channels.ddingtalk.slashCommand.sessionPrefix` 配置）
  - Feishu：`feishu:slash:<userId>`（通过 `CommandTargetSessionKey` 定向到聊天会话）
- **`/stop`** 定向到活动聊天会话，因此可以中止当前运行。
- **DingTalk：** `channels.ddingtalk.slashCommand` 仍然支持单个 `/crawclaw` 风格的命令。如果你启用 `commands.native`，你必须为每个内置命令创建一个 DingTalk 斜杠命令（与 `/help` 相同的名称）。DingTalk 的命令参数菜单以临时 Block Kit 按钮形式发送。
  - DingTalk native exception：注册 `/agentstatus`（不是 `/status`），因为 DingTalk 保留 `/status`。文本 `/status` 在 DingTalk 消息中仍然可用。

## BTW 侧问

`/btw` 是关于当前 session 的快速**侧问**。

不同于普通聊天：

- 它使用当前 session 作为背景上下文；
- 它作为独立的 **tool-less** one-shot call 运行；
- 它不会改变未来 session context；
- 它不会写入 transcript history；
- 它作为 live side result 投递，而不是普通 assistant message。

当你想在主任务继续推进时临时澄清问题，`/btw` 很有用。

示例：

```text
/btw what are we doing right now?
```

完整行为和 client UX 细节见 [BTW Side Questions](/tools/btw)。
