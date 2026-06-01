---
read_when:
  - 编辑系统提示词文本、工具列表或时间/心跳部分
  - 更改工作区引导或 Skills 注入行为
summary: CrawClaw 系统提示词的内容及其组装方式
title: 系统提示词
x-i18n:
  generated_at: "2026-06-01T16:10:29Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 1db82f54566e4d0ef048491d0be1bf13009c68a44ea9f0e8bfebddde4bf7c27e
  source_path: concepts/system-prompt.md
  workflow: 15
---

# 系统提示词

CrawClaw 为每次智能体运行构建自定义系统提示词。该提示词由 **CrawClaw 所有**，由 Rust 运行时路径组装。

## 结构

提示词故意保持紧凑并使用固定部分：

- **工具**：当前工具列表 + 简短描述。
- **安全**：简短的防护栏提醒，避免寻求权力行为或绕过监督。
- **Skills**（当可用时）：告知模型如何按需加载 skill 指令。
- **CrawClaw 自我更新**：如何运行 `config.apply` 和 `update.run`。
- **工作区**：工作目录（`agents.defaults.workspace`）。
- **文档**：CrawClaw 文档的本地路径（仓库或 npm 包）以及何时阅读它们。
- **工作区文件（已注入）**：表示引导文件已包含在下方。
- **当前日期和时间**：用户本地时间、时区和时间格式。
- **回复标签**：支持提供商的可选回复标签语法。
- **心跳**：事件驱动的主会话唤醒提示和确认行为，当唤醒运行提供心跳提示时。
- **运行时**：主机、操作系统、节点、模型、仓库根目录（当检测到时）、思考层级（一行）。
- **推理**：当前可见性级别 + `/reasoning` 切换提示。

## 提示词模式

CrawClaw 可以为子智能体渲染更小的系统提示词。运行时为每次运行设置 `promptMode`（非用户面向配置）：

- `full`（默认）：包含上述所有部分。
- `minimal`：用于子智能体；省略 **Skills**、**Memory Recall**、**CrawClaw
  自我更新**、**模型别名**、**用户身份**、**回复标签**、
  **消息**、**静默回复**和旧版**心跳**。工具、**安全**、上下文保持可用。
- `none`：仅返回基础身份行。

当 `promptMode=minimal` 时，额外的注入提示标记为 **Subagent
Context**（子智能体上下文）而非 **Group Chat Context**（群聊上下文）。

## 工作区引导注入

引导文件被裁剪并附加在 **Project Context**（项目上下文）下，以便模型看到单个规范的工作区指令文件，而无需显式读取：

- `AGENTS.md`

CrawClaw 在普通聊天轮次中不再默认注入这些文件：

- `SOUL.md`
- `TOOLS.md`
- `IDENTITY.md`
- `USER.md`
- `HEARTBEAT.md`
- `BOOTSTRAP.md`
- `MEMORY.md` / `memory.md`

这将默认引导集保持为单个文件，并避免每轮在 persona、启动、工具说明、身份、事件唤醒或内存文件上消耗提示词预算。

> **注意：** `memory/*.md` 每日文件**不会**自动注入。持久记忆召回在提示词组装期间选择有界限的相关笔记，而不是每轮在整个 memory 目录上燃烧上下文。

大文件会被截断并添加标记。每个文件的最大大小由 `agents.defaults.bootstrapMaxChars` 控制（默认：20000）。所有文件注入的引导内容总量由 `agents.defaults.bootstrapTotalMaxChars` 限制（默认：150000）。缺失文件会注入一个简短的缺失文件标记。当发生截断时，CrawClaw 可以在 Project Context 中注入警告块；通过 `agents.defaults.bootstrapPromptTruncationWarning` 控制此行为（`off`、`once`、`always`；默认：`once`）。

子智能体和 cron 会话也保持相同的单文件引导：`AGENTS.md`。

内部钩子可以通过 `agent:bootstrap` 拦截此步骤，以便在工作流真正需要比默认单文件引导更多内容时修改或替换注入的引导文件。

要检查每个注入文件的贡献量（原始 vs 注入、截断，加上工具 schema 开销），请使用 `/context list` 或 `/context detail`。请参阅 [Context](/concepts/context)。

## 提示词排序和动态上下文

CrawClaw 在动态系统上下文之前渲染稳定的系统提示词部分。这使得长期存在的提示词前缀更易于缓存，同时仍以相同请求中的系统可见指令形式发送记忆召回、钩子上下文和其他每轮 `system_context` 部分。

动态记忆上下文附加在基础系统提示词之后。该上下文可能每轮都变化，因为持久记忆、经验召回、钩子和路由诊断是查询相关的。将其保留在稳定前缀之后可以避免仅仅因为召回结果变化而使整个提示词前缀失效。

## 时间处理

当用户时区已知时，系统提示词包含专用的 **Current Date & Time**（当前日期和时间）部分。为了保持提示词缓存稳定，现在仅包含**时区**（无动态时钟或时间格式）。

当智能体需要当前时间时，使用 `session_status`；状态卡片包含时间戳行。

配置方式：

- `agents.defaults.userTimezone`
- `agents.defaults.timeFormat`（`auto` | `12` | `24`）

请参阅 [Date & Time](/date-time) 了解完整行为详情。

## Skills

当存在符合条件的 skills 时，CrawClaw 在 Rust 运行时上下文披露中最多显示五个相关 skill 摘要。每个摘要包含 skill 名称和描述。完整的 `SKILL.md` 内容仅在模型通过运行时 skill 工具显式加载 skill 后添加，且加载的 skill 内容在进入上下文之前有上限。

这保持了基础提示词的小体积，同时仍能实现有针对性的 skill 使用。

## 文档

当可用时，系统提示词包含一个 **Documentation**（文档）部分，指向本地 CrawClaw 文档目录（仓库工作区中的 `docs/` 或捆绑的 npm 包文档），并注明公开镜像、源码仓库、社区 community chat 和
ClawHub（[https://clawhub.com](https://clawhub.com)）以供 skills 发现。提示词指示模型首先查阅本地文档以了解 CrawClaw 行为、命令、配置或架构，并在可能时自己运行 CrawClaw Desktop 或本地 Gateway 网关 API（仅在无法访问时询问用户）。
