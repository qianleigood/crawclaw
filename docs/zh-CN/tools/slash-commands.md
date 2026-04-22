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
  source_hash: e44c1796704b5623e14500be06caa51932541f875f1ee2cd443fdb7a0f32d64a
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
      discord: ["user:123"],
    },
    useAccessGroups: true,
  },
}
```

- `commands.text`（默认 `true`）启用解析聊天消息中的 `/...`。
  - 在没有原生命令的平台上（WhatsApp/WebChat/Signal/iMessage/Google Chat/MS Teams），即使你将此设置为 `false`，文本命令仍然有效。
- `commands.native`（默认 `"auto"`）注册原生命令。
  - Auto：在 Discord/Telegram 上启用；在 Slack 上禁用（直到你添加斜杠命令）；在不支持原生命令的提供商上忽略。
  - 设置 `channels.discord.commands.native`、`channels.telegram.commands.native` 或 `channels.slack.commands.native` 以按提供商覆盖（布尔值或 `"auto"`）。
  - `false` 在启动时清除 Discord/Telegram 上之前注册的命令。Slack 命令在 Slack 应用中管理，不会自动删除。
- `commands.nativeSkills`（默认 `"auto"`）在支持时原生注册 **Skill** 命令。
  - Auto：在 Discord/Telegram 上启用；在 Slack 上禁用（Slack 需要为每个 Skill 创建一个斜杠命令）。
  - 设置 `channels.discord.commands.nativeSkills`、`channels.telegram.commands.nativeSkills` 或 `channels.slack.commands.nativeSkills` 以按提供商覆盖（布尔值或 `"auto"`）。
- `commands.bash`（默认 `false`）启用 `! <cmd>` 来运行主机 shell 命令（`/bash <cmd>` 是别名；需要 `tools.elevated` 白名单）。
- `commands.bashForegroundMs`（默认 `2000`）控制 bash 切换到后台模式之前等待多长时间（`0` 立即后台运行）。
- `commands.config`（默认 `false`）启用 `/config`（读写 `crawclaw.json`）。
- `commands.mcp`（默认 `false`）启用 `/mcp`（读写 CrawClaw 管理的 `mcp.servers` 配置）。
- `commands.plugins`（默认 `false`）启用 `/plugins`（插件发现/状态和安装/启停控制）。
- `commands.debug`（默认 `false`）启用 `/debug`（仅运行时覆盖）。
- `commands.allowFrom`（可选）按 provider 指定命令授权白名单。配置后，它会成为命令/指令的唯一授权来源。
- `commands.useAccessGroups`（默认 `true`）在未配置 `commands.allowFrom` 时，对命令强制执行白名单/策略。

## 命令列表

文本 + 原生（启用时）：

- `/help`
- `/commands`
- `/tools [compact|verbose]`（显示当前 agent 此刻能用的 runtime tools）
- `/skill <name> [input]`（按名称运行 Skill）
- `/status`（显示当前状态；在可用时包含当前模型提供商的提供商使用量/配额）
- `/tasks`（列出当前会话的后台任务）
- `/allowlist`（列出/添加/删除白名单条目）
- `/approve <id> allow-once|allow-always|deny`（解决 exec 审批提示）
- `/context [list|detail|json]`（解释"上下文"；`detail` 显示每个文件 + 每个工具 + 每个 Skill + 系统提示词大小）
- `/btw <question>`（针对当前会话发起一个不改变后续上下文的侧问）
- `/export-session [path]`（别名：`/export`，导出当前会话 HTML）
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
- `/debug show|set|unset|reset`（运行时覆盖，仅所有者；需要 `commands.debug: true`）
- `/usage off|tokens|full|cost`（每响应使用量页脚或本地成本摘要）
- `/tts off|always|inbound|tagged|status|provider|limit|summary|audio`（控制 TTS；参见 [/tools/tts](/tools/tts)）
  - Discord：原生命令是 `/voice`（Discord 保留了 `/tts`）；文本 `/tts` 仍然有效。
- `/stop`
- `/restart`
- `/dock-telegram`（别名：`/dock_telegram`）（将回复切换到 Telegram）
- `/dock-discord`（别名：`/dock_discord`）（将回复切换到 Discord）
- `/dock-slack`（别名：`/dock_slack`）（将回复切换到 Slack）
- `/activation mention|always`（仅限群组）
- `/send on|off|inherit`（仅所有者）
- `/new [model]`（可选模型提示；其余部分传递）
- `/think <off|minimal|low|medium|high|xhigh>`（按模型/提供商动态选择；别名：`/thinking`、`/t`）
- `/fast status|on|off`（省略参数时显示当前 fast-mode 状态）
- `/verbose on|full|off`（别名：`/v`）
- `/reasoning on|off|stream`（别名：`/reason`；启用时，发送带有 `Reasoning:` 前缀的单独消息；`stream` = 仅 Telegram 草稿）
- `/elevated on|off|ask|full`（别名：`/elev`；`full` 跳过 exec 审批）
- `/exec host=<auto|sandbox|gateway|node> security=<deny|allowlist|full> ask=<off|on-miss|always> node=<id>`（发送 `/exec` 显示当前设置）
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
- 要获取完整的提供商使用量分解，使用 `crawclaw status --usage`。
- `/allowlist add|remove` 需要 `commands.config=true` 并遵循渠道 `configWrites`。
- `/plugins install <spec>` 接受与 `crawclaw plugins install` 相同的 plugin spec。
- `/usage` 控制每响应使用量页脚；`/usage cost` 从 CrawClaw 会话日志打印本地成本摘要。
- `/restart` 默认启用；设置 `commands.restart: false` 可禁用。
- `/verbose` 用于调试和额外可见性；在正常使用中保持**关闭**。
- `/reasoning`（和 `/verbose`）在群组设置中有风险：它们可能会暴露你不打算公开的内部推理或工具输出。最好保持关闭，尤其是在群聊中。
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
- **原生命令参数：** Discord 使用自动完成进行动态选项（以及当你省略必需参数时的按钮菜单）。当命令支持选择且你省略参数时，Telegram 和 Slack 显示按钮菜单。

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
- `/model <#>` 从该选择器中选择（并在可能时优先选择当前提供商）。
- `/model status` 显示详细视图，包括在可用时配置的提供商端点（`baseUrl`）和 API 模式（`api`）。

## 调试覆盖

`/debug` 让你设置**仅运行时**的配置覆盖（内存，不写磁盘）。仅所有者。默认禁用；使用 `commands.debug: true` 启用。

示例：

```
/debug show
/debug set messages.responsePrefix="[crawclaw]"
/debug set channels.whatsapp.allowFrom=["+1555","+4477"]
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

## 平台注意事项

- **文本命令**在普通聊天会话中运行（私信共享 `main`，群组有自己的会话）。
- **原生命令**使用隔离的会话：
  - Discord：`agent:<agentId>:discord:slash:<userId>`
  - Slack：`agent:<agentId>:slack:slash:<userId>`（前缀可通过 `channels.slack.slashCommand.sessionPrefix` 配置）
  - Telegram：`telegram:slash:<userId>`（通过 `CommandTargetSessionKey` 定向到聊天会话）
- **`/stop`** 定向到活动聊天会话，因此可以中止当前运行。
- **Slack：** `channels.slack.slashCommand` 仍然支持单个 `/crawclaw` 风格的命令。如果你启用 `commands.native`，你必须为每个内置命令创建一个 Slack 斜杠命令（与 `/help` 相同的名称）。Slack 的命令参数菜单以临时 Block Kit 按钮形式发送。
